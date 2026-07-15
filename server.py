from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, urlopen


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT_DIR / "database" / "pms_gmc.sqlite"
DB_PATH = DEFAULT_DB_PATH

PERMISSION_LABELS = {
    "consultation": "Consultation",
    "ajout": "Ajout",
    "modification": "Modification",
    "suppression": "Suppression",
    "validation": "Validation",
    "administration": "Administration",
}
PASSWORD_ITERATIONS = 210_000
DEFAULT_ADMIN_PASSWORD = os.environ.get("PMS_ADMIN_PASSWORD", "Admin@2026!")
DEFAULT_USER_PASSWORD = os.environ.get("PMS_DEFAULT_USER_PASSWORD", "Palladium@2026!")
MIN_PASSWORD_LENGTH = 8
KOBO_REQUEST_TIMEOUT = 15
KOBO_SUBMISSION_LIMIT = 500
KOBO_FIELD_ALIASES = {
    "pole_id": ["pole_id", "pole", "id_pole", "pole_name", "pole_responsable"],
    "branch": ["branch_id", "branch", "filiale", "pays", "bu", "business_unit"],
    "kpi_name": ["kpi_id", "id_kpi", "kpi", "kpi_name", "nom_kpi", "indicateur"],
    "collector": ["_submitted_by", "submitted_by", "collector", "collecteur", "username", "responsable"],
    "submitted_at": ["_submission_time", "_date_submitted", "submission_time", "submitted_at", "end", "today"],
    "period": ["periode_reporting", "periode", "period", "periode_objectif", "mois", "date_reporting"],
    "value": ["kpi_value", "valeur", "value", "valeur_kpi", "resultat", "score", "realisation"],
    "validation_status": ["validation_status", "statut_validation", "validation_hierarchique", "validation"],
}


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        PASSWORD_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    try:
        algorithm, iterations, salt, digest = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            int(iterations),
        ).hex()
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, digest)


def validate_password(password: str) -> None:
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Le mot de passe doit contenir au moins {MIN_PASSWORD_LENGTH} caracteres.")


def sanitize_details(value):
    if isinstance(value, dict):
        sanitized = {}
        for key, item in value.items():
            key_lower = str(key).lower()
            if (
                "password" in key_lower
                or "motdepasse" in key_lower
                or "token" in key_lower
                or "secret" in key_lower
                or "authorization" in key_lower
            ):
                sanitized[key] = "***"
            else:
                sanitized[key] = sanitize_details(item)
        return sanitized
    if isinstance(value, list):
        return [sanitize_details(item) for item in value]
    return value


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", ".", ascii_value.lower()).strip(".")
    return slug or "utilisateur"


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    migrate_database(conn)
    return conn


def rows_as_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(row) for row in rows]


def audit(conn: sqlite3.Connection, action: str, entity_type: str, entity_id: str, details: dict | None = None) -> None:
    conn.execute(
        """
        INSERT INTO audit_logs (action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?)
        """,
        (action, entity_type, str(entity_id), json.dumps(sanitize_details(details or {}), ensure_ascii=False)),
    )


def migrate_database(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    changed = False
    if "password_hash" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        changed = True
    if "password_updated_at" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN password_updated_at TEXT")
        changed = True
    if "must_change_password" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0")
        changed = True

    submission_columns = {row["name"] for row in conn.execute("PRAGMA table_info(kobo_submissions)").fetchall()}
    if "submission_uid" not in submission_columns:
        conn.execute("ALTER TABLE kobo_submissions ADD COLUMN submission_uid TEXT")
        changed = True
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_kobo_submissions_uid
        ON kobo_submissions(form_uid, submission_uid)
        """
    )

    admin_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
    default_hash = hash_password(DEFAULT_USER_PASSWORD)
    conn.execute(
        """
        UPDATE users
        SET password_hash = ?,
            password_updated_at = COALESCE(password_updated_at, CURRENT_TIMESTAMP),
            must_change_password = COALESCE(must_change_password, 0)
        WHERE (password_hash IS NULL OR password_hash = '')
          AND (
            lower(email) IN ('administrateur.pms@palladium.local', 'admin@palladium.local')
            OR lower(full_name) IN ('administrateur pms', 'admin')
          )
        """,
        (admin_hash,),
    )
    conn.execute(
        """
        UPDATE users
        SET password_hash = ?,
            password_updated_at = COALESCE(password_updated_at, CURRENT_TIMESTAMP),
            must_change_password = COALESCE(must_change_password, 0)
        WHERE password_hash IS NULL OR password_hash = ''
        """,
        (default_hash,),
    )
    if changed or conn.total_changes:
        conn.commit()


def ensure_permission(conn: sqlite3.Connection, code: str) -> int:
    label = PERMISSION_LABELS.get(code, code.title())
    conn.execute(
        """
        INSERT INTO permissions (code, label, description)
        VALUES (?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET label = excluded.label
        """,
        (code, label, f"Droit {label.lower()} dans la plateforme PMS."),
    )
    row = conn.execute("SELECT id FROM permissions WHERE code = ?", (code,)).fetchone()
    return int(row["id"])


def ensure_profile(conn: sqlite3.Connection, profile: str) -> int:
    conn.execute(
        """
        INSERT INTO profiles (name, description)
        VALUES (?, ?)
        ON CONFLICT(name) DO NOTHING
        """,
        (profile, f"Profil {profile}"),
    )
    row = conn.execute("SELECT id FROM profiles WHERE name = ?", (profile,)).fetchone()
    if not row:
        raise ValueError(f"Profil introuvable: {profile}")
    return int(row["id"])


def ensure_user(
    conn: sqlite3.Connection,
    full_name: str,
    profile_id: int | None = None,
    initial_password: str | None = None,
) -> int:
    email = f"{slugify(full_name)}@palladium.local"
    password_hash = hash_password(initial_password or DEFAULT_USER_PASSWORD)
    conn.execute(
        """
        INSERT INTO users (
          full_name, email, default_profile_id, status, password_hash,
          password_updated_at, must_change_password, updated_at
        )
        VALUES (?, ?, ?, 'Actif', ?, CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(email) DO UPDATE SET
          full_name = excluded.full_name,
          default_profile_id = COALESCE(excluded.default_profile_id, users.default_profile_id),
          password_hash = COALESCE(NULLIF(users.password_hash, ''), excluded.password_hash),
          password_updated_at = COALESCE(users.password_updated_at, excluded.password_updated_at),
          updated_at = CURRENT_TIMESTAMP
        """,
        (full_name, email, profile_id, password_hash),
    )
    row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    return int(row["id"])


def upsert_user_details(
    conn: sqlite3.Connection,
    full_name: str,
    email: str | None,
    phone: str | None,
    profile_id: int | None,
    status: str = "Actif",
    password: str | None = None,
) -> int:
    normalized_email = (email or f"{slugify(full_name)}@palladium.local").strip().lower()
    password_hash = hash_password(password) if password else None
    conn.execute(
        """
        INSERT INTO users (
          full_name, email, phone, default_profile_id, status, password_hash,
          password_updated_at, must_change_password, updated_at
        )
        VALUES (?, ?, ?, ?, ?, COALESCE(?, ?), CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(email) DO UPDATE SET
          full_name = excluded.full_name,
          phone = excluded.phone,
          default_profile_id = COALESCE(excluded.default_profile_id, users.default_profile_id),
          status = excluded.status,
          password_hash = COALESCE(excluded.password_hash, users.password_hash),
          password_updated_at = CASE
            WHEN excluded.password_hash IS NOT NULL THEN CURRENT_TIMESTAMP
            ELSE users.password_updated_at
          END,
          must_change_password = CASE
            WHEN excluded.password_hash IS NOT NULL THEN excluded.must_change_password
            ELSE users.must_change_password
          END,
          updated_at = CURRENT_TIMESTAMP
        """,
        (
            full_name,
            normalized_email,
            phone,
            profile_id,
            status or "Actif",
            password_hash,
            hash_password(DEFAULT_USER_PASSWORD),
            1 if password_hash else 0,
        ),
    )
    row = conn.execute("SELECT id FROM users WHERE email = ?", (normalized_email,)).fetchone()
    return int(row["id"])


def ensure_pole(conn: sqlite3.Connection, pole_id: str, pole_name: str | None = None, owner: str | None = None) -> None:
    conn.execute(
        """
        INSERT INTO poles (id, category, name, owner, status)
        VALUES (?, 'Non classe', ?, ?, 'Actif')
        ON CONFLICT(id) DO UPDATE SET
          name = COALESCE(excluded.name, poles.name),
          owner = COALESCE(excluded.owner, poles.owner)
        """,
        (pole_id, pole_name or pole_id, owner),
    )


def list_profiles(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT pr.name AS profile, pe.code AS permission, COALESCE(pp.allowed, 0) AS allowed
        FROM profiles pr
        CROSS JOIN permissions pe
        LEFT JOIN profile_permissions pp
          ON pp.profile_id = pr.id AND pp.permission_id = pe.id
        ORDER BY pr.id, pe.id
        """
    ).fetchall()
    profiles: dict[str, dict] = {}
    for row in rows:
        profile = row["profile"]
        profiles.setdefault(profile, {"profile": profile, "permissions": {}})
        profiles[profile]["permissions"][row["permission"]] = bool(row["allowed"])
    return list(profiles.values())


def list_user_access(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, responsible, pole_id, pole_name, profile, dashboard_scope, status
        FROM v_user_access_details
        ORDER BY id DESC
        """
    ).fetchall()
    return [
        {
            "id": f"DB-{row['id']}",
            "dbId": row["id"],
            "responsible": row["responsible"],
            "poleId": row["pole_id"],
            "poleName": row["pole_name"],
            "role": row["profile"],
            "dashboardScope": row["dashboard_scope"],
            "permission": "Acces limite au dashboard de son pole",
            "status": row["status"],
            "className": "green" if row["status"] == "Actif" else "amber",
        }
        for row in rows
    ]


def objective_to_front(row: sqlite3.Row) -> dict:
    return {
        "id": f"OBJ-DB-{row['id']}",
        "dbId": row["id"],
        "poleId": row["pole_id"],
        "poleName": row["pole_name"],
        "kpiName": row["kpi_name"],
        "target": row["target"],
        "unit": row["unit"] or "",
        "period": row["period"],
        "frequency": row["frequency"] or "",
        "catalogId": row["code"] or "A definir",
        "type": row["type"] or "A preciser",
        "formula": row["formula"] or "A completer",
        "sourceData": row["source_data"] or "",
        "responsible": row["responsible"] or "",
        "validation": row["validation_status"] or "A valider",
        "documentStatus": row["document_status"] or "A preciser",
        "attention": row["attention_points"] or "",
        "sourceServer": row["source_server_url"] or "",
        "sourceForm": row["source_form_uid"] or "",
        "sourceFields": {
            "pole": "pole_id",
            "kpi": "kpi_id",
            "target": "objectif_kpi",
            "period": "periode_objectif",
            "unit": "unite_mesure",
            "frequency": "frequence_collecte",
            "source": "source_donnee",
            "validation": "validation_hierarchique",
        },
    }


def list_objectives(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
          obj.id,
          obj.pole_id,
          p.name AS pole_name,
          k.name AS kpi_name,
          k.code,
          k.type,
          k.formula,
          obj.period,
          obj.target,
          obj.unit,
          obj.frequency,
          obj.source_form_uid,
          obj.source_server_url,
          obj.source_data,
          obj.responsible,
          obj.validation_status,
          obj.document_status,
          obj.attention_points
        FROM kpi_objectives obj
        JOIN kpis k ON k.id = obj.kpi_id
        JOIN poles p ON p.id = obj.pole_id
        ORDER BY obj.updated_at DESC, obj.id DESC
        """
    ).fetchall()
    return [objective_to_front(row) for row in rows]


def report_to_front(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "pole": row["pole_id"],
        "cycle": row["cycle"],
        "period": row["period"],
        "format": row["format"],
        "status": row["status"],
        "generatedAt": row["generated_at"] or row["created_at"],
    }


def list_reports(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, pole_id, cycle, period, format, status, generated_at, created_at
        FROM reports
        ORDER BY created_at DESC, id DESC
        LIMIT 50
        """
    ).fetchall()
    return [report_to_front(row) for row in rows]


def active_kobo_form(conn: sqlite3.Connection) -> dict | None:
    form = conn.execute(
        """
        SELECT id, uid, title, server_url, source_type, status
        FROM kobo_forms
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
        """
    ).fetchone()
    if not form:
        return None

    fields = rows_as_dicts(
        conn.execute(
            """
            SELECT field_name AS name, field_type AS type, field_label AS label
            FROM kobo_form_fields
            WHERE form_id = ?
            ORDER BY id
            """,
            (form["id"],),
        ).fetchall()
    )
    return {
        "uid": form["uid"],
        "mode": form["source_type"],
        "name": form["title"],
        "origin": form["server_url"] or form["uid"],
        "detail": "Formulaire actif charge depuis la base locale.",
        "status": form["status"],
        "statusClass": "green" if form["status"] in ("Actif", "Connecte", "Charge") else "amber",
        "fields": fields,
    }


def kobo_source_role(source_type: str) -> str:
    value = (source_type or "").lower()
    if "donnees de calcul" in value:
        return "donneesCalcul"
    if "referentiel" in value or "objectifs kpi" in value:
        return "referentielKpi"
    return "autre"


def list_kobo_sources(conn: sqlite3.Connection) -> list[dict]:
    forms = conn.execute(
        """
        SELECT id, uid, title, server_url, source_type, status
        FROM kobo_forms
        ORDER BY updated_at DESC, id DESC
        """
    ).fetchall()
    sources = []
    for form in forms:
        role = kobo_source_role(form["source_type"])
        if role == "autre":
            continue
        fields = conn.execute(
            """
            SELECT field_name, mapped_to
            FROM kobo_form_fields
            WHERE form_id = ?
            ORDER BY id
            """,
            (form["id"],),
        ).fetchall()
        mapped_fields = {
            row["mapped_to"]: row["field_name"]
            for row in fields
            if row["mapped_to"] and row["field_name"]
        }
        sources.append(
            {
                "role": role,
                "serverUrl": form["server_url"] or "",
                "formId": form["uid"],
                "title": form["title"],
                "mode": form["source_type"],
                "status": form["status"],
                "mappedFields": mapped_fields,
            }
        )
    return sources


def user_to_front(row: sqlite3.Row, default_pole_id: str | None = None, default_pole_name: str | None = None) -> dict:
    return {
        "id": row["id"],
        "fullName": row["full_name"],
        "email": row["email"] or "",
        "phone": row["phone"] or "",
        "profile": row["profile"] or "Manager / Responsable",
        "status": row["status"] or "Actif",
        "defaultPoleId": row["default_pole_id"] if "default_pole_id" in row.keys() else default_pole_id,
        "defaultPoleName": row["default_pole_name"] if "default_pole_name" in row.keys() else default_pole_name,
    }


def list_users(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
          u.id,
          u.full_name,
          u.email,
          u.phone,
          u.status,
          COALESCE(pr.name, apr.name, 'Manager / Responsable') AS profile,
          ua.pole_id AS default_pole_id,
          p.name AS default_pole_name
        FROM users u
        LEFT JOIN profiles pr ON pr.id = u.default_profile_id
        LEFT JOIN user_access ua ON ua.id = (
          SELECT id FROM user_access
          WHERE user_id = u.id AND status = 'Actif'
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        )
        LEFT JOIN profiles apr ON apr.id = ua.profile_id
        LEFT JOIN poles p ON p.id = ua.pole_id
        ORDER BY u.updated_at DESC, u.full_name
        """
    ).fetchall()
    return [user_to_front(row) for row in rows]


def get_bootstrap_payload() -> dict:
    with db_connect() as conn:
        return {
            "profiles": list_profiles(conn),
            "users": list_users(conn),
            "userAccess": list_user_access(conn),
            "objectives": list_objectives(conn),
            "reportHistory": list_reports(conn),
            "activeKoboForm": active_kobo_form(conn),
            "koboSources": list_kobo_sources(conn),
        }


def save_profile_permissions(payload: dict) -> list[dict]:
    profile = str(payload.get("profile") or "").strip()
    permissions = payload.get("permissions") or {}
    if not profile:
        raise ValueError("Le profil est obligatoire.")

    with db_connect() as conn:
        profile_id = ensure_profile(conn, profile)
        for code in PERMISSION_LABELS:
            permission_id = ensure_permission(conn, code)
            allowed = 1 if bool(permissions.get(code)) else 0
            conn.execute(
                """
                INSERT INTO profile_permissions (profile_id, permission_id, allowed)
                VALUES (?, ?, ?)
                ON CONFLICT(profile_id, permission_id) DO UPDATE SET allowed = excluded.allowed
                """,
                (profile_id, permission_id, allowed),
            )
        audit(conn, "Mise a jour droits profil", "profile", profile, {"permissions": permissions})
        conn.commit()
        return list_profiles(conn)


def create_platform_user(payload: dict) -> dict:
    full_name = str(payload.get("fullName") or payload.get("full_name") or "").strip()
    email = str(payload.get("email") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    profile = str(payload.get("profile") or "Manager / Responsable").strip()
    status = str(payload.get("status") or "Actif").strip()
    password = str(payload.get("password") or payload.get("temporaryPassword") or "").strip()
    default_pole_id = str(payload.get("defaultPoleId") or "").strip()
    default_pole_name = str(payload.get("defaultPoleName") or "").strip()
    if not full_name:
        raise ValueError("Le nom complet est obligatoire.")
    validate_password(password)

    with db_connect() as conn:
        profile_id = ensure_profile(conn, profile)
        user_id = upsert_user_details(conn, full_name, email or None, phone or None, profile_id, status, password)
        audit(conn, "Creation utilisateur", "user", str(user_id), payload)
        conn.commit()
        row = conn.execute(
            """
            SELECT
              u.id,
              u.full_name,
              u.email,
              u.phone,
              u.status,
              pr.name AS profile,
              ? AS default_pole_id,
              ? AS default_pole_name
            FROM users u
            LEFT JOIN profiles pr ON pr.id = u.default_profile_id
            WHERE u.id = ?
            """,
            (default_pole_id or None, default_pole_name or None, user_id),
        ).fetchone()
        return user_to_front(row, default_pole_id or None, default_pole_name or None)


def save_user_access(payload: dict) -> dict:
    user_id_payload = payload.get("userId")
    responsible = str(payload.get("responsible") or "").strip()
    email = str(payload.get("email") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    pole_id = str(payload.get("poleId") or "").strip()
    pole_name = str(payload.get("poleName") or pole_id).strip()
    profile = str(payload.get("role") or payload.get("profile") or "").strip()
    dashboard_scope = str(payload.get("dashboardScope") or f"Dashboard Suivi KPI - {pole_name}").strip()
    if not responsible or not pole_id or not profile:
        raise ValueError("Responsable, pole et profil sont obligatoires.")

    with db_connect() as conn:
        profile_id = ensure_profile(conn, profile)
        ensure_pole(conn, pole_id, pole_name, responsible)
        user_id = None
        if user_id_payload not in (None, ""):
            try:
                parsed_user_id = int(str(user_id_payload).replace("USR-", ""))
                row = conn.execute("SELECT id FROM users WHERE id = ?", (parsed_user_id,)).fetchone()
                if row:
                    user_id = int(row["id"])
            except ValueError:
                user_id = None

        if user_id:
            conn.execute(
                """
                UPDATE users
                SET full_name = ?,
                    email = COALESCE(NULLIF(?, ''), email),
                    phone = COALESCE(NULLIF(?, ''), phone),
                    default_profile_id = ?,
                    status = 'Actif',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (responsible, email, phone, profile_id, user_id),
            )
        else:
            user_id = upsert_user_details(conn, responsible, email or None, phone or None, profile_id, "Actif")
        conn.execute(
            """
            INSERT INTO user_access (user_id, pole_id, profile_id, dashboard_scope, status, updated_at)
            VALUES (?, ?, ?, ?, 'Actif', CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, pole_id) DO UPDATE SET
              profile_id = excluded.profile_id,
              dashboard_scope = excluded.dashboard_scope,
              status = 'Actif',
              updated_at = CURRENT_TIMESTAMP
            """,
            (user_id, pole_id, profile_id, dashboard_scope),
        )
        audit(conn, "Affectation acces utilisateur", "user_access", f"{responsible}:{pole_id}", payload)
        conn.commit()
        row = conn.execute(
            """
            SELECT id, responsible, pole_id, pole_name, profile, dashboard_scope, status
            FROM v_user_access_details
            WHERE responsible = ? AND pole_id = ?
            """,
            (responsible, pole_id),
        ).fetchone()
        return list_user_access_from_rows([row])[0]


def list_user_access_from_rows(rows: list[sqlite3.Row]) -> list[dict]:
    return [
        {
            "id": f"DB-{row['id']}",
            "dbId": row["id"],
            "responsible": row["responsible"],
            "poleId": row["pole_id"],
            "poleName": row["pole_name"],
            "role": row["profile"],
            "dashboardScope": row["dashboard_scope"],
            "permission": "Acces limite au dashboard de son pole",
            "status": row["status"],
            "className": "green" if row["status"] == "Actif" else "amber",
        }
        for row in rows
        if row is not None
    ]


def permission_map_for_profile(conn: sqlite3.Connection, profile_id: int) -> dict:
    rows = conn.execute(
        """
        SELECT pe.code, COALESCE(pp.allowed, 0) AS allowed
        FROM permissions pe
        LEFT JOIN profile_permissions pp
          ON pp.permission_id = pe.id AND pp.profile_id = ?
        ORDER BY pe.id
        """,
        (profile_id,),
    ).fetchall()
    return {row["code"]: bool(row["allowed"]) for row in rows}


def access_for_session(conn: sqlite3.Connection, user_id: int, profile: str, permissions: dict) -> list[dict]:
    if permissions.get("administration"):
        rows = conn.execute(
            """
            SELECT id, owner AS responsible, id AS pole_id, name AS pole_name
            FROM poles
            ORDER BY category, name
            """
        ).fetchall()
        return [
            {
                "id": f"ADMIN-{row['pole_id']}",
                "responsible": row["responsible"] or "Administrateur PMS",
                "poleId": row["pole_id"],
                "poleName": row["pole_name"],
                "role": profile,
                "dashboardScope": f"Dashboard Suivi KPI - {row['pole_name']}",
                "permission": "Acces administration a tous les dashboards",
                "status": "Actif",
                "className": "green",
            }
            for row in rows
        ]

    rows = conn.execute(
        """
        SELECT id, responsible, pole_id, pole_name, profile, dashboard_scope, status
        FROM v_user_access_details
        WHERE id IN (
          SELECT id FROM user_access WHERE user_id = ?
        )
        ORDER BY pole_name
        """,
        (user_id,),
    ).fetchall()
    return list_user_access_from_rows(rows)


def authenticate_user(payload: dict) -> dict:
    identifier = str(payload.get("identifier") or "").strip()
    password = str(payload.get("password") or payload.get("accessCode") or "").strip()
    if not identifier or not password:
        raise ValueError("Identifiant et mot de passe obligatoires.")

    normalized_identifier = identifier.lower()
    with db_connect() as conn:
        if normalized_identifier in {"admin", "administrateur", "admin@palladium.local"}:
            profile_id = ensure_profile(conn, "Administrateur")
            user_id = ensure_user(conn, "Administrateur PMS", profile_id, DEFAULT_ADMIN_PASSWORD)
            conn.commit()
        else:
            row = conn.execute(
                """
                SELECT id, default_profile_id
                FROM users
                WHERE lower(email) = lower(?)
                   OR lower(full_name) = lower(?)
                """,
                (identifier, identifier),
            ).fetchone()
            if not row:
                raise ValueError("Utilisateur introuvable dans la base.")
            user_id = int(row["id"])
            profile_id = row["default_profile_id"]
            if not profile_id:
                access_row = conn.execute(
                    "SELECT profile_id FROM user_access WHERE user_id = ? ORDER BY id LIMIT 1",
                    (user_id,),
                ).fetchone()
                profile_id = int(access_row["profile_id"]) if access_row else ensure_profile(conn, "Manager / Responsable")

        user = conn.execute(
            """
            SELECT
              u.id,
              u.full_name,
              u.email,
              u.status,
              u.password_hash,
              pr.name AS profile,
              pr.id AS profile_id
            FROM users u
            JOIN profiles pr ON pr.id = ?
            WHERE u.id = ?
            """,
            (profile_id, user_id),
        ).fetchone()
        if not user or user["status"] != "Actif":
            raise ValueError("Compte utilisateur inactif ou introuvable.")
        if not verify_password(password, user["password_hash"]):
            raise ValueError("Mot de passe incorrect.")

        permissions = permission_map_for_profile(conn, int(user["profile_id"]))
        access = access_for_session(conn, int(user["id"]), user["profile"], permissions)
        audit(conn, "Connexion utilisateur", "user", str(user["id"]), {"profile": user["profile"]})
        conn.commit()
        return {
            "user": {
                "id": user["id"],
                "fullName": user["full_name"],
                "email": user["email"],
                "profile": user["profile"],
            },
            "permissions": permissions,
            "access": access,
        }


def ensure_kpi(conn: sqlite3.Connection, payload: dict) -> int:
    pole_id = str(payload.get("poleId") or "").strip()
    pole_name = str(payload.get("poleName") or pole_id).strip()
    kpi_name = str(payload.get("kpiName") or "").strip()
    catalog_id = str(payload.get("catalogId") or "").strip()
    if not pole_id or not kpi_name:
        raise ValueError("Le pole et le KPI sont obligatoires.")

    ensure_pole(conn, pole_id, pole_name, str(payload.get("responsible") or "").strip() or None)
    row = conn.execute(
        "SELECT id FROM kpis WHERE pole_id = ? AND lower(name) = lower(?)",
        (pole_id, kpi_name),
    ).fetchone()
    if not row and catalog_id and catalog_id != "A definir":
        row = conn.execute("SELECT id FROM kpis WHERE code = ?", (catalog_id,)).fetchone()
    if row:
        kpi_id = int(row["id"])
        conn.execute(
            """
            UPDATE kpis
            SET type = COALESCE(?, type),
                formula = COALESCE(?, formula),
                unit = COALESCE(?, unit),
                data_source = COALESCE(?, data_source),
                responsible = COALESCE(?, responsible),
                source_form_uid = COALESCE(?, source_form_uid),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                payload.get("type"),
                payload.get("formula"),
                payload.get("unit"),
                payload.get("sourceData"),
                payload.get("responsible"),
                payload.get("sourceForm"),
                kpi_id,
            ),
        )
        return kpi_id

    code = catalog_id if catalog_id and catalog_id != "A definir" else None
    conn.execute(
        """
        INSERT INTO kpis (
          code, pole_id, name, type, unit, formula, target, collection_frequency,
          data_source, source_form_uid, responsible, respondent, validator,
          document_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            code,
            pole_id,
            kpi_name,
            payload.get("type"),
            payload.get("unit"),
            payload.get("formula"),
            payload.get("target"),
            payload.get("frequency"),
            payload.get("sourceData"),
            payload.get("sourceForm"),
            payload.get("responsible"),
            payload.get("respondent"),
            payload.get("validation"),
            payload.get("documentStatus"),
        ),
    )
    return int(conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])


def save_objective(payload: dict) -> dict:
    target = str(payload.get("target") or "").strip()
    period = str(payload.get("period") or "").strip()
    pole_id = str(payload.get("poleId") or "").strip()
    source_form = str(payload.get("sourceForm") or "").strip()
    source_server = str(payload.get("sourceServer") or "").strip()
    if not target or not period or not pole_id:
        raise ValueError("Pole, periode et objectif sont obligatoires.")
    if not source_form or not source_server:
        raise ValueError("Les objectifs doivent provenir d'un formulaire KoboCollect.")

    with db_connect() as conn:
        kpi_id = ensure_kpi(conn, payload)
        conn.execute(
            """
            INSERT INTO kpi_objectives (
              kpi_id, pole_id, period, target, unit, frequency, source_form_uid,
              source_server_url, source_data, responsible, validation_status,
              document_status, attention_points, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(kpi_id, pole_id, period) DO UPDATE SET
              target = excluded.target,
              unit = excluded.unit,
              frequency = excluded.frequency,
              source_form_uid = excluded.source_form_uid,
              source_server_url = excluded.source_server_url,
              source_data = excluded.source_data,
              responsible = excluded.responsible,
              validation_status = excluded.validation_status,
              document_status = excluded.document_status,
              attention_points = excluded.attention_points,
              updated_at = CURRENT_TIMESTAMP
            """,
            (
                kpi_id,
                pole_id,
                period,
                target,
                payload.get("unit"),
                payload.get("frequency"),
                source_form,
                source_server,
                payload.get("sourceData"),
                payload.get("responsible"),
                payload.get("validation"),
                payload.get("documentStatus"),
                payload.get("attention"),
            ),
        )
        objective_id = conn.execute(
            """
            SELECT id FROM kpi_objectives
            WHERE kpi_id = ? AND pole_id = ? AND period = ?
            """,
            (kpi_id, pole_id, period),
        ).fetchone()["id"]
        audit(conn, "Enregistrement objectif KPI", "kpi_objective", str(objective_id), payload)
        conn.commit()
        row = conn.execute(
            """
            SELECT
              obj.id,
              obj.pole_id,
              p.name AS pole_name,
              k.name AS kpi_name,
              k.code,
              k.type,
              k.formula,
              obj.period,
              obj.target,
              obj.unit,
              obj.frequency,
              obj.source_form_uid,
              obj.source_server_url,
              obj.source_data,
              obj.responsible,
              obj.validation_status,
              obj.document_status,
              obj.attention_points
            FROM kpi_objectives obj
            JOIN kpis k ON k.id = obj.kpi_id
            JOIN poles p ON p.id = obj.pole_id
            WHERE obj.id = ?
            """,
            (objective_id,),
        ).fetchone()
        return objective_to_front(row)


def save_report(payload: dict) -> dict:
    report_id = str(payload.get("id") or "").strip()
    pole_id = str(payload.get("pole") or payload.get("poleId") or "").strip()
    cycle = str(payload.get("cycle") or "").strip()
    period = str(payload.get("period") or "").strip()
    if not report_id or not pole_id or not cycle or not period:
        raise ValueError("Rapport incomplet.")

    with db_connect() as conn:
        ensure_pole(conn, pole_id, str(payload.get("poleName") or pole_id))
        conn.execute(
            """
            INSERT INTO reports (id, pole_id, cycle, period, format, status, generated_at, comment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              pole_id = excluded.pole_id,
              cycle = excluded.cycle,
              period = excluded.period,
              format = excluded.format,
              status = excluded.status,
              generated_at = excluded.generated_at,
              comment = excluded.comment
            """,
            (
                report_id,
                pole_id,
                cycle,
                period,
                payload.get("format") or "PDF",
                payload.get("status") or "Brouillon",
                payload.get("generatedAt"),
                payload.get("comment"),
            ),
        )
        audit(conn, "Generation rapport", "report", report_id, payload)
        conn.commit()
        row = conn.execute(
            """
            SELECT id, pole_id, cycle, period, format, status, generated_at, created_at
            FROM reports
            WHERE id = ?
            """,
            (report_id,),
        ).fetchone()
        return report_to_front(row)


def normalize_kobo_server_url(raw_url: str) -> str:
    value = (raw_url or "").strip()
    if not value:
        return ""
    candidate = value if re.match(r"^https?://", value, re.I) else f"https://{value}"
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    path = parsed.path.rstrip("/")
    if path.endswith("/api/v2"):
        path = path[: -len("/api/v2")]
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def kobo_api_url(server_url: str, api_path: str) -> str:
    return f"{server_url.rstrip('/')}/{api_path.lstrip('/')}"


def kobo_request_json(server_url: str, api_path: str, token: str) -> dict | list:
    headers = {
        "Accept": "application/json",
        "User-Agent": "PMS-GMC-Platform/1.0",
    }
    if token:
        headers["Authorization"] = f"Token {token}"

    request = Request(kobo_api_url(server_url, api_path), headers=headers)
    try:
        with urlopen(request, timeout=KOBO_REQUEST_TIMEOUT) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return json.loads(response.read().decode(charset))
    except HTTPError as exc:
        detail = exc.read(500).decode("utf-8", errors="ignore").strip()
        if exc.code in (401, 403):
            raise ValueError("Jeton API Kobo refuse ou droits insuffisants pour ce formulaire.") from exc
        if exc.code == 404:
            raise ValueError("Formulaire Kobo introuvable avec cet UID.") from exc
        suffix = f" Detail: {detail[:160]}" if detail else ""
        raise ValueError(f"KoboToolbox a repondu avec l'erreur {exc.code}.{suffix}") from exc
    except URLError as exc:
        raise ValueError(f"Serveur Kobo injoignable: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError("La reponse Kobo n'est pas un JSON exploitable.") from exc


def kobo_label_to_text(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        for item in value:
            text = kobo_label_to_text(item)
            if text:
                return text
        return ""
    if isinstance(value, dict):
        for key in ("fr", "French", "Francais", "default", "English", "en"):
            text = kobo_label_to_text(value.get(key))
            if text:
                return text
        for item in value.values():
            text = kobo_label_to_text(item)
            if text:
                return text
    return ""


def extract_kobo_form_title(asset: dict, fallback_uid: str) -> str:
    content = asset.get("content") if isinstance(asset, dict) else {}
    settings = content.get("settings") if isinstance(content, dict) else {}
    if isinstance(settings, dict):
        title = settings.get("form_title") or settings.get("title")
        if title:
            return str(title)
    return str(asset.get("name") or asset.get("uid") or fallback_uid)


def extract_kobo_asset_fields(asset: dict) -> list[dict]:
    content = asset.get("content") if isinstance(asset, dict) else {}
    survey = content.get("survey") if isinstance(content, dict) else []
    if not isinstance(survey, list):
        return []

    fields = []
    skipped_types = {"begin_group", "end_group", "begin_repeat", "end_repeat"}
    for item in survey:
        if not isinstance(item, dict):
            continue
        field_type = str(item.get("type") or "Champ Kobo").strip()
        if field_type in skipped_types:
            continue
        field_name = str(item.get("name") or item.get("$kuid") or "").strip()
        if not field_name:
            continue
        fields.append(
            {
                "name": field_name,
                "type": field_type,
                "label": kobo_label_to_text(item.get("label")) or field_name,
            }
        )
    return fields[:80]


def extract_kobo_submissions(payload: dict | list) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("results", "data", "submissions"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    if any(str(key).startswith("_") for key in payload):
        return [payload]
    return []


def normalize_submission_key(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "_", ascii_value.lower()).strip("_")


def flatten_submission(submission: dict, prefix: str = "") -> dict:
    flattened = {}
    for key, value in submission.items():
        full_key = f"{prefix}/{key}" if prefix else str(key)
        if isinstance(value, dict):
            flattened.update(flatten_submission(value, full_key))
        elif not isinstance(value, list):
            flattened[full_key] = value
    return flattened


def submission_value(submission: dict, aliases: list[str]):
    flattened = flatten_submission(submission)
    lookup = {}
    suffix_lookup = {}
    for key, value in flattened.items():
        lookup[normalize_submission_key(key)] = value
        suffix_lookup[normalize_submission_key(key.split("/")[-1])] = value

    for alias in aliases:
        normalized_alias = normalize_submission_key(alias)
        if normalized_alias in lookup:
            return lookup[normalized_alias]
        if normalized_alias in suffix_lookup:
            return suffix_lookup[normalized_alias]
    return None


def submission_uid(submission: dict) -> str:
    explicit_id = submission_value(
        submission,
        ["_uuid", "uuid", "_id", "id", "_submission_id", "meta/instanceID", "instanceID"],
    )
    if explicit_id not in (None, ""):
        return str(explicit_id)
    raw = json.dumps(submission, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def resolve_submission_pole_id(conn: sqlite3.Connection, value) -> str | None:
    if value in (None, ""):
        return None
    raw_value = str(value).strip()
    row = conn.execute(
        """
        SELECT id
        FROM poles
        WHERE id = ?
           OR lower(name) = lower(?)
        LIMIT 1
        """,
        (raw_value, raw_value),
    ).fetchone()
    return row["id"] if row else None


def sync_kobo_form(payload: dict) -> dict:
    server_url = normalize_kobo_server_url(str(payload.get("serverUrl") or payload.get("origin") or ""))
    form_uid = str(payload.get("formUid") or payload.get("uid") or payload.get("name") or "").strip()
    token = str(payload.get("token") or payload.get("apiToken") or "").strip()
    if not server_url or not form_uid:
        raise ValueError("Adresse serveur Kobo et UID formulaire obligatoires.")
    if not token:
        raise ValueError("Jeton API Kobo obligatoire pour synchroniser le formulaire.")

    encoded_uid = quote(form_uid, safe="")
    asset = kobo_request_json(server_url, f"/api/v2/assets/{encoded_uid}/", token)
    if not isinstance(asset, dict):
        raise ValueError("Metadonnees Kobo inattendues pour ce formulaire.")

    form_title = extract_kobo_form_title(asset, form_uid)
    fields = extract_kobo_asset_fields(asset)
    data_warning = ""
    submissions = []
    try:
        data = kobo_request_json(
            server_url,
            f"/api/v2/assets/{encoded_uid}/data/?format=json&limit={KOBO_SUBMISSION_LIMIT}",
            token,
        )
        submissions = extract_kobo_submissions(data)
    except ValueError as exc:
        data_warning = str(exc)

    with db_connect() as conn:
        conn.execute(
            """
            INSERT INTO kobo_forms (uid, title, server_url, source_type, status, updated_at)
            VALUES (?, ?, ?, 'Connexion KoboToolbox', 'Connecte', CURRENT_TIMESTAMP)
            ON CONFLICT(uid) DO UPDATE SET
              title = excluded.title,
              server_url = excluded.server_url,
              source_type = excluded.source_type,
              status = excluded.status,
              updated_at = CURRENT_TIMESTAMP
            """,
            (form_uid, form_title, server_url),
        )
        form_id = conn.execute("SELECT id FROM kobo_forms WHERE uid = ?", (form_uid,)).fetchone()["id"]
        conn.execute("DELETE FROM kobo_form_fields WHERE form_id = ?", (form_id,))
        for field in fields:
            conn.execute(
                """
                INSERT INTO kobo_form_fields (form_id, field_name, field_label, field_type, mapped_to)
                VALUES (?, ?, ?, ?, ?)
                """,
                (form_id, field["name"], field["label"], field["type"], None),
            )

        imported = 0
        for submission in submissions[:KOBO_SUBMISSION_LIMIT]:
            uid = submission_uid(submission)
            values = {key: submission_value(submission, aliases) for key, aliases in KOBO_FIELD_ALIASES.items()}
            pole_id = resolve_submission_pole_id(conn, values.get("pole_id"))
            conn.execute(
                """
                INSERT INTO kobo_submissions (
                  submission_uid,
                  form_uid,
                  pole_id,
                  branch,
                  kpi_name,
                  collector,
                  submitted_at,
                  period,
                  value,
                  validation_status,
                  raw_payload_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(form_uid, submission_uid) DO UPDATE SET
                  pole_id = excluded.pole_id,
                  branch = excluded.branch,
                  kpi_name = excluded.kpi_name,
                  collector = excluded.collector,
                  submitted_at = excluded.submitted_at,
                  period = excluded.period,
                  value = excluded.value,
                  validation_status = excluded.validation_status,
                  raw_payload_json = excluded.raw_payload_json
                """,
                (
                    uid,
                    form_uid,
                    pole_id,
                    values.get("branch"),
                    values.get("kpi_name"),
                    values.get("collector"),
                    values.get("submitted_at"),
                    values.get("period"),
                    None if values.get("value") is None else str(values.get("value")),
                    values.get("validation_status") or "A valider",
                    json.dumps(submission, ensure_ascii=False),
                ),
            )
            imported += 1

        audit(
            conn,
            "Synchronisation Kobo",
            "kobo_form",
            form_uid,
            {"serverUrl": server_url, "fields": len(fields), "submissions": imported, "warning": data_warning},
        )
        conn.commit()
        active_form = active_kobo_form(conn) or {}
        synced_at = conn.execute("SELECT CURRENT_TIMESTAMP AS synced_at").fetchone()["synced_at"]

    detail = f"{len(fields)} champ(s) detecte(s), {imported} soumission(s) lue(s)."
    if data_warning:
        detail = f"{detail} Soumissions non importees: {data_warning}"
    active_form["detail"] = detail
    active_form["lastSyncAt"] = synced_at
    return {
        "activeForm": active_form,
        "fieldsDetected": len(fields),
        "submissionsImported": imported,
        "syncWarning": data_warning,
        "lastSyncAt": synced_at,
    }


def save_kobo_form(payload: dict) -> dict:
    name = str(payload.get("name") or "").strip()
    origin = str(payload.get("origin") or "").strip()
    mode = str(payload.get("mode") or "KoboCollect").strip()
    status = str(payload.get("status") or "Actif").strip()
    fields = payload.get("fields") or []
    if not name:
        raise ValueError("Nom du formulaire Kobo obligatoire.")

    uid = slugify(name)
    mode_lower = mode.lower()
    if mode_lower.startswith("connexion") or "kobocollect" in mode_lower:
        uid = name

    with db_connect() as conn:
        conn.execute(
            """
            INSERT INTO kobo_forms (uid, title, server_url, source_type, status, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(uid) DO UPDATE SET
              title = excluded.title,
              server_url = excluded.server_url,
              source_type = excluded.source_type,
              status = excluded.status,
              updated_at = CURRENT_TIMESTAMP
            """,
            (uid, name, origin, mode, status),
        )
        form_id = conn.execute("SELECT id FROM kobo_forms WHERE uid = ?", (uid,)).fetchone()["id"]
        for field in fields[:80]:
            field_name = str(field.get("name") or "").strip()
            if not field_name:
                continue
            conn.execute(
                """
                INSERT INTO kobo_form_fields (form_id, field_name, field_label, field_type, mapped_to)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(form_id, field_name) DO UPDATE SET
                  field_label = excluded.field_label,
                  field_type = excluded.field_type,
                  mapped_to = excluded.mapped_to
                """,
                (
                    form_id,
                    field_name,
                    field.get("label"),
                    field.get("type"),
                    field.get("mappedTo"),
                ),
            )
        audit(conn, "Connexion formulaire Kobo", "kobo_form", uid, {"name": name, "mode": mode, "fields": len(fields)})
        conn.commit()
        return active_kobo_form(conn) or {}


class PMSHandler(BaseHTTPRequestHandler):
    server_version = "PMSGMC/1.0"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        return

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/api/health":
                self.send_json({"database": str(DB_PATH), "status": "ok"})
                return
            if path == "/api/bootstrap":
                self.send_json(get_bootstrap_payload())
                return
            if path.startswith("/api/"):
                self.send_error_json(404, "Endpoint API introuvable.")
                return
            self.send_static(path)
        except Exception as exc:
            self.send_error_json(500, str(exc))

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self.read_json_body()
            if path == "/api/auth/login":
                self.send_json(authenticate_user(payload))
                return
            if path == "/api/users":
                self.send_json(create_platform_user(payload))
                return
            if path == "/api/access/profile-permissions":
                self.send_json(save_profile_permissions(payload))
                return
            if path == "/api/access/user-access":
                self.send_json(save_user_access(payload))
                return
            if path == "/api/objectives":
                self.send_json(save_objective(payload))
                return
            if path == "/api/reports":
                self.send_json(save_report(payload))
                return
            if path == "/api/kobo/forms":
                self.send_json(save_kobo_form(payload))
                return
            if path == "/api/kobo/sync":
                self.send_json(sync_kobo_form(payload))
                return
            self.send_error_json(404, "Endpoint API introuvable.")
        except Exception as exc:
            self.send_error_json(400, str(exc))

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def send_json(self, data: dict | list, status: int = 200) -> None:
        body = json.dumps({"ok": True, "data": data}, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: int, message: str) -> None:
        body = json.dumps({"ok": False, "error": message}, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, raw_path: str) -> None:
        requested = unquote(raw_path.lstrip("/")) or "index.html"
        full_path = (ROOT_DIR / requested).resolve()
        try:
            full_path.relative_to(ROOT_DIR.resolve())
        except ValueError:
            self.send_error_json(403, "Acces refuse.")
            return
        if full_path.is_dir():
            full_path = full_path / "index.html"
        if not full_path.exists() or not full_path.is_file():
            self.send_error_json(404, "Fichier introuvable.")
            return

        content_type = mimetypes.guess_type(full_path.name)[0] or "application/octet-stream"
        content = full_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main() -> None:
    global DB_PATH
    parser = argparse.ArgumentParser(description="Serveur local PMS GMC Group")
    default_host = os.environ.get("HOST", "127.0.0.1")
    default_port = int(os.environ.get("PORT", "5184"))
    default_db = os.environ.get("PMS_DB_PATH", str(DEFAULT_DB_PATH))
    parser.add_argument("--host", default=default_host)
    parser.add_argument("--port", type=int, default=default_port)
    parser.add_argument("--db", default=default_db)
    args = parser.parse_args()

    DB_PATH = Path(args.db).resolve()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), PMSHandler)
    print(f"PMS GMC API disponible sur http://{args.host}:{args.port}/")
    print(f"Base SQLite: {DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
