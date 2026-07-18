from __future__ import annotations

import argparse
import ast
import datetime as dt
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
CATALOG_POLE_ALIASES = {
    "direction finance comptabilite": "DFC",
    "direction finance et comptabilite": "DFC",
    "dfc": "DFC",
    "pole systeme management qualite": "PSMQ",
    "pole systeme de management de la qualite": "PSMQ",
    "psmq": "PSMQ",
    "pole wfm": "WFM",
    "wfm": "WFM",
    "pole projet drive": "DRIVE",
    "drive": "DRIVE",
    "pole commercial": "COM",
    "commercial": "COM",
    "pole marketing communication": "COM",
    "pole marketing et communication": "COM",
    "pole gestionnaire compte": "GDC",
    "pole gestionnaire de compte": "GDC",
    "dcm": "GDC",
    "direction comptes": "GDC",
    "direction des comptes": "GDC",
    "pole recouvrement": "REC",
    "recouvrement": "REC",
    "bu retail distribution": "BRD",
    "bu retail et distribution": "BRD",
    "hoope ci": "BRD",
    "hoope cote ivoire": "BRD",
    "hoope cote d ivoire": "BRD",
    "hoope niger": "BRD",
    "hoope nig": "BRD",
    "bu bpo": "BPO",
    "bpo": "BPO",
    "bu innovation developpement": "BID",
    "bu innovation et developpement": "BID",
    "aaim": "BID",
    "dpb": "BID",
    "sci": "BID",
    "pole performance amelioration continue": "PAC",
    "pole performance et amelioration continue": "PAC",
    "pac": "PAC",
    "pole voix client epc": "EPC",
    "pole voix du client epc": "EPC",
    "pole epc": "EPC",
    "poles epc": "EPC",
    "epc": "EPC",
    "direction systeme informatique": "DSI",
    "direction du systeme informatique": "DSI",
    "dsi": "DSI",
    "direction capital humain": "DCH",
    "direction du capital humain": "DCH",
    "dch": "DCH",
    "pole moyens generaux": "PMG",
    "pmg": "PMG",
    "consolide": "PAC",
    "consolidee": "PAC",
    "performance globale": "PAC",
}
LOWER_IS_BETTER_TERMS = {
    "abandon",
    "absence",
    "absenteisme",
    "anomalie",
    "creance",
    "delai",
    "duree",
    "erreur",
    "incident",
    "indisponibilite",
    "perte",
    "retard",
    "risque",
    "rupture",
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


def unique_index_columns(conn: sqlite3.Connection, table: str) -> list[list[str]]:
    indexes = conn.execute(f"PRAGMA index_list({table})").fetchall()
    unique_columns = []
    for index in indexes:
        if not index["unique"]:
            continue
        index_name = str(index["name"]).replace("'", "''")
        columns = [
            row["name"]
            for row in conn.execute(f"PRAGMA index_info('{index_name}')").fetchall()
            if row["name"]
        ]
        unique_columns.append(columns)
    return unique_columns


def create_user_access_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE user_access (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          pole_id TEXT NOT NULL,
          branch TEXT NOT NULL DEFAULT 'Groupe',
          profile_id INTEGER NOT NULL,
          dashboard_scope TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Actif',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, pole_id, branch),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (pole_id) REFERENCES poles(id) ON DELETE CASCADE,
          FOREIGN KEY (profile_id) REFERENCES profiles(id)
        )
        """
    )


def recreate_user_access_view(conn: sqlite3.Connection) -> None:
    conn.execute("DROP VIEW IF EXISTS v_user_access_details")
    conn.execute(
        """
        CREATE VIEW v_user_access_details AS
        SELECT
          ua.id,
          u.full_name AS responsible,
          u.email,
          p.id AS pole_id,
          p.name AS pole_name,
          ua.branch,
          pr.name AS profile,
          ua.dashboard_scope,
          ua.status
        FROM user_access ua
        JOIN users u ON u.id = ua.user_id
        JOIN poles p ON p.id = ua.pole_id
        JOIN profiles pr ON pr.id = ua.profile_id
        """
    )


def ensure_user_access_schema(conn: sqlite3.Connection) -> bool:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(user_access)").fetchall()}
    if not columns:
        create_user_access_table(conn)
        recreate_user_access_view(conn)
        return True

    unique_columns = unique_index_columns(conn, "user_access")
    needs_rebuild = "branch" not in columns or ["user_id", "pole_id", "branch"] not in unique_columns
    if not needs_rebuild:
        recreate_user_access_view(conn)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_user_access_branch ON user_access(branch)")
        return False

    branch_select = "COALESCE(NULLIF(branch, ''), 'Groupe')" if "branch" in columns else "'Groupe'"
    conn.execute("DROP VIEW IF EXISTS v_user_access_details")
    conn.execute("ALTER TABLE user_access RENAME TO user_access_old")
    create_user_access_table(conn)
    conn.execute(
        f"""
        INSERT OR IGNORE INTO user_access (
          id, user_id, pole_id, branch, profile_id, dashboard_scope, status, created_at, updated_at
        )
        SELECT
          id,
          user_id,
          pole_id,
          {branch_select},
          profile_id,
          dashboard_scope,
          status,
          created_at,
          updated_at
        FROM user_access_old
        """
    )
    conn.execute("DROP TABLE user_access_old")
    recreate_user_access_view(conn)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_user_access_user ON user_access(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_user_access_pole ON user_access(pole_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_user_access_branch ON user_access(branch)")
    return True


def ensure_kpi_daily_data_schema(conn: sqlite3.Connection) -> bool:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kpi_daily_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data_date TEXT NOT NULL,
          pole_id TEXT NOT NULL,
          branch TEXT NOT NULL DEFAULT '',
          kpi_key TEXT NOT NULL,
          kpi_raw TEXT,
          element_key TEXT NOT NULL,
          element_label TEXT,
          raw_value TEXT,
          numeric_value REAL,
          validation_status TEXT,
          source_form_uid TEXT NOT NULL,
          source_submission_uid TEXT NOT NULL,
          submitted_at TEXT,
          collector TEXT,
          raw_payload_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (data_date, pole_id, branch, kpi_key, element_key, source_form_uid, source_submission_uid),
          FOREIGN KEY (pole_id) REFERENCES poles(id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_kpi_daily_data_date ON kpi_daily_data(data_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_kpi_daily_data_scope ON kpi_daily_data(pole_id, kpi_key, data_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_kpi_daily_data_source ON kpi_daily_data(source_form_uid, source_submission_uid)")
    return True


def migrate_database(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    changed = False
    changed = ensure_user_access_schema(conn) or changed
    ensure_kpi_daily_data_schema(conn)
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
        SELECT id, responsible, pole_id, pole_name, branch, profile, dashboard_scope, status
        FROM v_user_access_details
        ORDER BY branch, pole_name, responsible
        """
    ).fetchall()
    return [
        {
            "id": f"DB-{row['id']}",
            "dbId": row["id"],
            "responsible": row["responsible"],
            "poleId": row["pole_id"],
            "poleName": row["pole_name"],
            "branch": row["branch"] or "Groupe",
            "countryName": row["branch"] or "Groupe",
            "role": row["profile"],
            "dashboardScope": row["dashboard_scope"],
            "permission": f"Acces limite a {row['branch'] or 'Groupe'} / {row['pole_name']}",
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


def user_to_front(
    row: sqlite3.Row,
    default_pole_id: str | None = None,
    default_pole_name: str | None = None,
    default_branch: str | None = None,
) -> dict:
    return {
        "id": row["id"],
        "fullName": row["full_name"],
        "email": row["email"] or "",
        "phone": row["phone"] or "",
        "profile": row["profile"] or "Manager / Responsable",
        "status": row["status"] or "Actif",
        "defaultPoleId": row["default_pole_id"] if "default_pole_id" in row.keys() else default_pole_id,
        "defaultPoleName": row["default_pole_name"] if "default_pole_name" in row.keys() else default_pole_name,
        "defaultBranch": row["default_branch"] if "default_branch" in row.keys() else default_branch or "Groupe",
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
          ua.branch AS default_branch,
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
        kpi_results, kpi_quality = calculate_kpi_results(conn)
        return {
            "profiles": list_profiles(conn),
            "users": list_users(conn),
            "userAccess": list_user_access(conn),
            "objectives": list_objectives(conn),
            "reportHistory": list_reports(conn),
            "activeKoboForm": active_kobo_form(conn),
            "koboSources": list_kobo_sources(conn),
            "koboSubmissions": list_kobo_submissions(conn),
            "kpiCalculationResults": kpi_results,
            "kpiCalculationQuality": kpi_quality,
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
    default_branch = str(payload.get("defaultBranch") or payload.get("branch") or "Groupe").strip() or "Groupe"
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
              ? AS default_branch,
              ? AS default_pole_name
            FROM users u
            LEFT JOIN profiles pr ON pr.id = u.default_profile_id
            WHERE u.id = ?
            """,
            (default_pole_id or None, default_branch, default_pole_name or None, user_id),
        ).fetchone()
        return user_to_front(row, default_pole_id or None, default_pole_name or None, default_branch)


def save_user_access(payload: dict) -> dict:
    user_id_payload = payload.get("userId")
    responsible = str(payload.get("responsible") or "").strip()
    email = str(payload.get("email") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    pole_id = str(payload.get("poleId") or "").strip()
    pole_name = str(payload.get("poleName") or pole_id).strip()
    branch = str(payload.get("branch") or payload.get("countryName") or payload.get("country") or "Groupe").strip() or "Groupe"
    profile = str(payload.get("role") or payload.get("profile") or "").strip()
    dashboard_scope = str(payload.get("dashboardScope") or f"Dashboard Suivi KPI - {branch} - {pole_name}").strip()
    if not responsible or not pole_id or not branch or not profile:
        raise ValueError("Responsable, pays/filiale, pole et profil sont obligatoires.")

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
            INSERT INTO user_access (user_id, pole_id, branch, profile_id, dashboard_scope, status, updated_at)
            VALUES (?, ?, ?, ?, ?, 'Actif', CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, pole_id, branch) DO UPDATE SET
              profile_id = excluded.profile_id,
              dashboard_scope = excluded.dashboard_scope,
              status = 'Actif',
              updated_at = CURRENT_TIMESTAMP
            """,
            (user_id, pole_id, branch, profile_id, dashboard_scope),
        )
        audit(conn, "Affectation acces utilisateur", "user_access", f"{responsible}:{branch}:{pole_id}", payload)
        conn.commit()
        row = conn.execute(
            """
            SELECT id, responsible, pole_id, pole_name, branch, profile, dashboard_scope, status
            FROM v_user_access_details
            WHERE responsible = ? AND pole_id = ? AND branch = ?
            """,
            (responsible, pole_id, branch),
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
            "branch": row["branch"] or "Groupe",
            "countryName": row["branch"] or "Groupe",
            "role": row["profile"],
            "dashboardScope": row["dashboard_scope"],
            "permission": f"Acces limite a {row['branch'] or 'Groupe'} / {row['pole_name']}",
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
                "branch": "Groupe",
                "countryName": "Groupe",
                "role": profile,
                "dashboardScope": f"Dashboard Suivi KPI - Groupe - {row['pole_name']}",
                "permission": "Acces administration a tous les pays et poles",
                "status": "Actif",
                "className": "green",
            }
            for row in rows
        ]

    rows = conn.execute(
        """
        SELECT id, responsible, pole_id, pole_name, branch, profile, dashboard_scope, status
        FROM v_user_access_details
        WHERE id IN (
          SELECT id FROM user_access WHERE user_id = ?
        )
        ORDER BY branch, pole_name
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


def normalize_match_key(value) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", ascii_value.lower()).strip()


def resolve_catalog_pole_id(conn: sqlite3.Connection, value) -> str | None:
    if value in (None, ""):
        return None
    raw_value = str(value).strip()
    direct_id = resolve_submission_pole_id(conn, raw_value)
    if direct_id:
        return direct_id

    normalized = normalize_match_key(raw_value)
    alias_id = CATALOG_POLE_ALIASES.get(normalized)
    if alias_id:
        return alias_id

    for alias, pole_id in CATALOG_POLE_ALIASES.items():
        if alias and (alias in normalized or normalized in alias):
            return pole_id

    rows = conn.execute("SELECT id, name FROM poles").fetchall()
    for row in rows:
        pole_name = normalize_match_key(row["name"])
        if pole_name and (normalized == pole_name or normalized in pole_name or pole_name in normalized):
            return row["id"]
    return None


def parse_raw_payload(row: sqlite3.Row) -> dict:
    raw_payload = row["raw_payload_json"] if "raw_payload_json" in row.keys() else None
    if raw_payload:
        try:
            payload = json.loads(raw_payload)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            pass
    return {
        "pole_id": row["pole_id"] if "pole_id" in row.keys() else None,
        "branch": row["branch"] if "branch" in row.keys() else None,
        "kpi_name": row["kpi_name"] if "kpi_name" in row.keys() else None,
        "period": row["period"] if "period" in row.keys() else None,
        "value": row["value"] if "value" in row.keys() else None,
        "validation_status": row["validation_status"] if "validation_status" in row.keys() else None,
    }


def mapped_submission_value(source: dict, submission: dict, mapped_to: str, aliases: list[str] | None = None):
    mapped_fields = source.get("mappedFields") or {}
    candidates = [
        mapped_fields.get(mapped_to),
        mapped_to,
        *(aliases or []),
    ]
    return submission_value(submission, [candidate for candidate in candidates if candidate])


def text_or_empty(value) -> str:
    if value in (None, ""):
        return ""
    return str(value).strip()


PERIOD_MONTH_INDEX = {
    "janvier": 1,
    "janv": 1,
    "fevrier": 2,
    "fevr": 2,
    "mars": 3,
    "avril": 4,
    "avr": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "juil": 7,
    "aout": 8,
    "septembre": 9,
    "sept": 9,
    "octobre": 10,
    "oct": 10,
    "novembre": 11,
    "nov": 11,
    "decembre": 12,
    "dec": 12,
}


def safe_date(year: int, month: int, day: int) -> dt.date | None:
    try:
        return dt.date(year, month, day)
    except ValueError:
        return None


def parse_daily_period_date(value) -> dt.date | None:
    raw_value = text_or_empty(value)
    if not raw_value:
        return None

    compact_date = re.search(r"\b(20\d{2})(\d{2})(\d{2})\b", raw_value)
    if compact_date:
        return safe_date(int(compact_date.group(1)), int(compact_date.group(2)), int(compact_date.group(3)))

    iso_date = re.search(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b", raw_value)
    if iso_date:
        return safe_date(int(iso_date.group(1)), int(iso_date.group(2)), int(iso_date.group(3)))

    dmy_date = re.search(r"\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b", raw_value)
    if dmy_date:
        return safe_date(int(dmy_date.group(3)), int(dmy_date.group(2)), int(dmy_date.group(1)))

    normalized = normalize_match_key(raw_value)
    named_date = re.search(r"\b(\d{1,2})\s+([a-z]+)\s+(20\d{2})\b", normalized)
    if named_date:
        month_key = named_date.group(2)
        month = PERIOD_MONTH_INDEX.get(month_key)
        if not month:
            month = next(
                (month_number for name, month_number in PERIOD_MONTH_INDEX.items() if month_key.startswith(name) or name.startswith(month_key)),
                None,
            )
        if month:
            return safe_date(int(named_date.group(3)), month, int(named_date.group(1)))

    return None


def month_to_date_label(target_date: dt.date) -> str:
    start_date = target_date.replace(day=1)
    if start_date == target_date:
        return f"Jour du {target_date.isoformat()}"
    return f"Cumul du {start_date.isoformat()} au {target_date.isoformat()}"


def parse_number(value) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = unicodedata.normalize("NFD", str(value))
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.replace("\u00a0", " ").strip()
    match = re.search(r"[-+]?\d+(?:[\s.]\d{3})*(?:,\d+)?|[-+]?\d+(?:\.\d+)?", text)
    if not match:
        return None
    number_text = match.group(0).replace(" ", "")
    if "," in number_text and "." in number_text:
        number_text = number_text.replace(".", "").replace(",", ".")
    else:
        number_text = number_text.replace(",", ".")
    try:
        return float(number_text)
    except ValueError:
        return None


def format_number(value: float, decimals: int = 1) -> str:
    if value is None:
        return "N/A"
    if abs(value - round(value)) < 0.005:
        return f"{round(value):,}".replace(",", " ")
    return f"{value:,.{decimals}f}".replace(",", " ").rstrip("0").rstrip(".")


def format_calculated_value(value: float, unit: str) -> str:
    normalized_unit = normalize_match_key(unit)
    if "pourcentage" in normalized_unit or normalized_unit == "%" or "%" in str(unit or ""):
        return f"{format_number(value)}%"
    if "fcfa" in normalized_unit or "xof" in normalized_unit or "montant" in normalized_unit:
        return f"{format_number(value, 0)} FCFA"
    if "minute" in normalized_unit:
        return f"{format_number(value)} min"
    if "jour" in normalized_unit:
        return f"{format_number(value)} j"
    return format_number(value)


def parse_target_rule(target: str, kpi_name: str = "", formula: str = "") -> dict:
    target_text = str(target or "")
    normalized = normalize_match_key(target_text)
    numbers = [parse_number(match) for match in re.findall(r"[-+]?\d+(?:[,.]\d+)?", target_text)]
    numbers = [number for number in numbers if number is not None]
    lower_better = "<" in target_text or any(term in normalize_match_key(f"{kpi_name} {formula}") for term in LOWER_IS_BETTER_TERMS)

    if not numbers:
        return {"mode": "none", "value": None, "lowerBetter": lower_better}
    if "<" in target_text or "maximum" in normalized or "max" in normalized:
        return {"mode": "max", "value": numbers[0], "lowerBetter": True}
    if ">" in target_text or "minimum" in normalized or "min" in normalized:
        return {"mode": "min", "value": numbers[0], "lowerBetter": False}
    if len(numbers) >= 2 and re.search(r"\d\s*[-–]\s*\d", target_text):
        return {"mode": "range", "min": min(numbers[:2]), "max": max(numbers[:2]), "lowerBetter": False}
    return {"mode": "max" if lower_better else "min", "value": numbers[0], "lowerBetter": lower_better}


def rag_status(value: float | None, target: str, kpi_name: str = "", formula: str = "") -> str:
    if value is None:
        return "gray"
    rule = parse_target_rule(target, kpi_name, formula)
    mode = rule.get("mode")
    if mode == "none":
        return "gray"
    if mode == "range":
        low = float(rule["min"])
        high = float(rule["max"])
        margin = max((high - low) * 0.15, max(abs(high), 1) * 0.05)
        if low <= value <= high:
            return "green"
        if (low - margin) <= value <= (high + margin):
            return "amber"
        return "red"

    target_value = rule.get("value")
    if target_value in (None, 0):
        return "gray"
    target_value = float(target_value)
    if mode == "max":
        if value <= target_value:
            return "green"
        if value <= target_value * 1.1:
            return "amber"
        return "red"
    if value >= target_value:
        return "green"
    if value >= target_value * 0.9:
        return "amber"
    return "red"


def normalize_formula_expression(formula: str) -> str:
    normalized = unicodedata.normalize("NFD", str(formula or ""))
    text = normalized.encode("ascii", "ignore").decode("ascii").lower()
    text = text.replace("×", "*").replace("÷", "/")
    text = re.sub(r"(?<=\d),(?=\d)", ".", text)
    text = re.sub(r"(?<=\d|\))\s*[x]\s*(?=\d|\(|[a-z])", " * ", text)
    text = re.sub(r"\bx\b", " * ", text)
    text = re.sub(r"\bfois\b", " * ", text)
    text = re.sub(r"\bpourcent\b|%", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def ratio_formula_with_parentheses(expression: str) -> str:
    compact = re.sub(r"\s+", "", expression)
    if compact.count("/") == 1 and compact.endswith("*100") and not compact.startswith("("):
        left, right = compact.split("/", 1)
        right = right[:-4]
        if left and right:
            return f"({left})/({right})*100"
    return expression


def safe_eval_expression(expression: str, variables: dict[str, float]) -> float | None:
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return None

    allowed_nodes = (
        ast.Expression,
        ast.BinOp,
        ast.UnaryOp,
        ast.Constant,
        ast.Name,
        ast.Load,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.Pow,
        ast.Mod,
        ast.USub,
        ast.UAdd,
    )
    for node in ast.walk(tree):
        if not isinstance(node, allowed_nodes):
            return None
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            return None
        if isinstance(node, ast.Name) and node.id not in variables:
            return None
    try:
        result = eval(compile(tree, "<kpi_formula>", "eval"), {"__builtins__": {}}, variables)
    except (ArithmeticError, NameError, TypeError, ValueError):
        return None
    if not isinstance(result, (int, float)):
        return None
    return float(result)


def aggregate_numeric_elements(elements: list[dict]) -> tuple[dict[str, float], list[float]]:
    values: dict[str, float] = {}
    raw_numbers = []
    for element in elements:
        number = parse_number(element.get("value"))
        if number is None:
            continue
        raw_numbers.append(number)
        label = normalize_match_key(element.get("label") or "valeur")
        if not label:
            label = "valeur"
        values[label] = values.get(label, 0.0) + number
    return values, raw_numbers


def evaluate_kpi_formula(formula: str, elements: list[dict]) -> tuple[float | None, str, list[str]]:
    warnings: list[str] = []
    element_values, raw_numbers = aggregate_numeric_elements(elements)
    formula_key = normalize_match_key(formula)
    if not element_values:
        return None, "Aucune valeur numerique", ["Aucune valeur numerique exploitable dans le formulaire donnees."]

    if "moyenne" in formula_key and raw_numbers:
        return sum(raw_numbers) / len(raw_numbers), "Moyenne des elements Kobo", warnings

    if formula:
        expression = normalize_formula_expression(formula)
        variables: dict[str, float] = {}
        for index, label in enumerate(sorted(element_values, key=len, reverse=True)):
            variable = f"v{index}"
            pattern = rf"(?<![a-z0-9]){re.escape(label)}(?![a-z0-9])"
            expression, count = re.subn(pattern, variable, expression)
            if count:
                variables[variable] = element_values[label]
        expression = ratio_formula_with_parentheses(expression)
        if variables and not re.search(r"\b(?!v\d+\b)[a-z_]+\b", expression):
            result = safe_eval_expression(expression, variables)
            if result is not None:
                return result, "Formule catalogue appliquee", warnings
        warnings.append("Formule non interpretee automatiquement: verifier les libelles des elements.")

    for preferred in ("resultat", "valeur kpi", "kpi value", "realisation", "score"):
        preferred_key = normalize_match_key(preferred)
        for label, value in element_values.items():
            if preferred_key in label:
                return value, "Valeur KPI directe", warnings

    if len(element_values) == 1:
        label, value = next(iter(element_values.items()))
        return value, f"Valeur unique Kobo: {label}", warnings

    return None, "Calcul a verifier", warnings or ["Plusieurs elements trouves, mais aucune formule exploitable."]


def status_class_from_validation(status: str) -> str:
    normalized = normalize_match_key(status)
    if any(term in normalized for term in ("valide", "ok", "approuve")):
        return "green"
    if any(term in normalized for term in ("erreur", "rejete", "critique")):
        return "red"
    if any(term in normalized for term in ("retard", "manquant", "attente", "valider")):
        return "amber"
    return "gray"


def upsert_kpi_daily_data(
    conn: sqlite3.Connection,
    *,
    data_date: dt.date,
    pole_id: str,
    branch: str,
    kpi_key: str,
    kpi_raw: str,
    element_label: str,
    raw_value,
    validation_status: str,
    source_form_uid: str,
    source_submission_uid: str,
    submitted_at: str,
    collector: str,
    raw_payload_json: str,
) -> None:
    element_key = normalize_submission_key(element_label or "valeur")
    if not element_key:
        element_key = "valeur"
    conn.execute(
        """
        INSERT INTO kpi_daily_data (
          data_date,
          pole_id,
          branch,
          kpi_key,
          kpi_raw,
          element_key,
          element_label,
          raw_value,
          numeric_value,
          validation_status,
          source_form_uid,
          source_submission_uid,
          submitted_at,
          collector,
          raw_payload_json,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(data_date, pole_id, branch, kpi_key, element_key, source_form_uid, source_submission_uid)
        DO UPDATE SET
          kpi_raw = excluded.kpi_raw,
          element_label = excluded.element_label,
          raw_value = excluded.raw_value,
          numeric_value = excluded.numeric_value,
          validation_status = excluded.validation_status,
          submitted_at = excluded.submitted_at,
          collector = excluded.collector,
          raw_payload_json = excluded.raw_payload_json,
          updated_at = CURRENT_TIMESTAMP
        """,
        (
            data_date.isoformat(),
            pole_id,
            text_or_empty(branch),
            kpi_key,
            text_or_empty(kpi_raw),
            element_key,
            text_or_empty(element_label or "valeur"),
            None if raw_value is None else str(raw_value),
            parse_number(raw_value),
            text_or_empty(validation_status or "A valider"),
            source_form_uid,
            source_submission_uid,
            submitted_at,
            collector,
            raw_payload_json,
        ),
    )


def list_kobo_submissions(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
          s.form_uid,
          s.branch,
          s.kpi_name,
          s.collector,
          s.period,
          s.validation_status,
          s.created_at,
          p.name AS pole_name,
          f.title AS form_title,
          f.source_type
        FROM kobo_submissions s
        LEFT JOIN poles p ON p.id = s.pole_id
        LEFT JOIN kobo_forms f ON f.uid = s.form_uid
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 120
        """
    ).fetchall()
    submissions = []
    for row in rows:
        status = row["validation_status"] or "A valider"
        submissions.append(
            {
                "form": row["form_title"] or row["form_uid"],
                "branch": row["branch"] or row["pole_name"] or row["period"] or "Perimetre non renseigne",
                "kpi": row["kpi_name"] or "KPI non renseigne",
                "collector": row["collector"] or "KoboCollect",
                "status": status,
                "className": status_class_from_validation(status),
                "period": row["period"] or "",
                "sourceRole": kobo_source_role(row["source_type"] or ""),
            }
        )
    return submissions


def calculate_kpi_results(conn: sqlite3.Connection) -> tuple[list[dict], dict]:
    sources = list_kobo_sources(conn)
    source_by_role: dict[str, dict] = {}
    for source in sources:
        source_by_role.setdefault(source["role"], source)

    reference_source = source_by_role.get("referentielKpi")
    calculation_source = source_by_role.get("donneesCalcul")
    quality = {
        "configured": bool(reference_source),
        "calculationFormConfigured": bool(calculation_source),
        "referenceCount": 0,
        "calculationRecords": 0,
        "dailyDataRows": 0,
        "calculationGroups": 0,
        "matchedCalculationGroups": 0,
        "calculatedCount": 0,
        "unmatchedCalculationCount": 0,
        "uncalculatedCount": 0,
        "missingTargetCount": 0,
        "missingFormulaCount": 0,
        "matchRate": 0,
        "calculationRate": 0,
        "referenceKpis": [],
        "warnings": [],
        "proposals": [],
    }

    if not reference_source:
        quality["proposals"].append(
            "Configurer le formulaire KPI/formules dans Administration > KoboCollecte pour afficher les KPI par pole."
        )
        return [], quality

    reference_rows = conn.execute(
        """
        SELECT *
        FROM kobo_submissions
        WHERE form_uid = ?
        ORDER BY created_at DESC, id DESC
        """,
        (reference_source["formId"],),
    ).fetchall()
    calculation_rows = (
        conn.execute(
            """
            SELECT *
            FROM kobo_submissions
            WHERE form_uid = ?
            ORDER BY created_at DESC, id DESC
            """,
            (calculation_source["formId"],),
        ).fetchall()
        if calculation_source
        else []
    )

    quality["referenceCount"] = len(reference_rows)
    quality["calculationRecords"] = len(calculation_rows)
    if not reference_rows:
        quality["warnings"].append("Aucune soumission trouvee pour le formulaire KPI/formules.")
    if not calculation_source:
        quality["warnings"].append("Formulaire donnees de calcul non configure.")
    elif not calculation_rows:
        quality["warnings"].append("Aucune soumission trouvee pour le formulaire donnees de calcul.")

    references: list[dict] = []
    reference_lookup: dict[tuple[str, str], dict] = {}
    reference_by_kpi: dict[str, dict | None] = {}

    for row in reference_rows:
        payload = parse_raw_payload(row)
        pole_raw = mapped_submission_value(
            reference_source,
            payload,
            "pole",
            ["groupe_de_rattachement", "sous_entite_pole_filiale", "direction_pole", "direction", "pole_id", "pole"],
        )
        pole_id = resolve_catalog_pole_id(conn, pole_raw or row["pole_id"])
        kpi_code = text_or_empty(mapped_submission_value(reference_source, payload, "id", ["id_kpi", "kpi_id", "code", "n", "numero"]))
        kpi_name = text_or_empty(
            mapped_submission_value(reference_source, payload, "title", ["intitule_du_kpi", "indicateur_kpi", "indicateur", "kpi_name", "kpi"])
        )
        if not pole_id or not (kpi_code or kpi_name):
            quality["warnings"].append("Reference KPI ignoree: pole ou KPI non reconnu.")
            continue

        record = {
            "poleId": pole_id,
            "kpiId": kpi_code or normalize_match_key(kpi_name).upper(),
            "kpiName": kpi_name or kpi_code,
            "formula": text_or_empty(mapped_submission_value(reference_source, payload, "formula", ["formule_de_calcul", "formule"])),
            "target": text_or_empty(mapped_submission_value(reference_source, payload, "target", ["valeur_cible", "seuil_cible", "objectif", "objectif_cible"])),
            "unit": text_or_empty(mapped_submission_value(reference_source, payload, "unit", ["unite_de_mesure", "unite"])),
            "sourceData": text_or_empty(
                mapped_submission_value(reference_source, payload, "sourceData", ["source_de_la_donnee", "source_donnee"])
            ),
            "owner": text_or_empty(mapped_submission_value(reference_source, payload, "owner", ["responsable_du_kpi"])),
            "collectionFrequency": text_or_empty(
                mapped_submission_value(reference_source, payload, "collectionFrequency", ["frequence_de_collecte", "frequence"])
            ),
            "reportingFrequency": text_or_empty(
                mapped_submission_value(reference_source, payload, "reportingFrequency", ["periodicite_du_reporting"])
            ),
        }
        references.append(record)
        if not record["formula"]:
            quality["missingFormulaCount"] += 1
        if not record["target"]:
            quality["missingTargetCount"] += 1

        keys = [record["kpiId"], record["kpiName"]]
        for key_value in keys:
            key = normalize_match_key(key_value)
            if not key:
                continue
            reference_lookup[(pole_id, key)] = record
            if key not in reference_by_kpi:
                reference_by_kpi[key] = record
            elif reference_by_kpi[key] and reference_by_kpi[key]["poleId"] != pole_id:
                reference_by_kpi[key] = None

    groups: dict[tuple[str, str, str], dict] = {}
    calculation_entries: list[dict] = []

    def add_calculation_group(
        pole_id: str,
        kpi_key: str,
        kpi_raw: str,
        period_label: str,
        element: dict,
        *,
        group_period_key: str | None = None,
        period_start: str = "",
        period_end: str = "",
        period_type: str = "period",
    ) -> None:
        group_key = (pole_id, kpi_key, normalize_match_key(group_period_key or period_label))
        group = groups.setdefault(
            group_key,
            {
                "poleId": pole_id,
                "kpiKey": kpi_key,
                "kpiRaw": kpi_raw,
                "period": period_label,
                "periodStart": period_start,
                "periodEnd": period_end,
                "periodType": period_type,
                "elements": [],
            },
        )
        group["elements"].append(element)

    for row in calculation_rows:
        payload = parse_raw_payload(row)
        pole_raw = mapped_submission_value(
            calculation_source,
            payload,
            "pole",
            ["pole_id", "pole", "groupe_de_rattachement", "direction_pole", "direction"],
        )
        pole_id = resolve_catalog_pole_id(conn, pole_raw or row["pole_id"])
        kpi_raw = mapped_submission_value(
            calculation_source,
            payload,
            "kpi",
            ["id_kpi", "kpi_id", "kpi_name", "kpi", "indicateur_kpi", "indicateur", "indicateur_qualite", "indicateur_dcm_conformite"],
        )
        period_raw = mapped_submission_value(
            calculation_source,
            payload,
            "period",
            ["periode_reporting", "periode", "period", "date_collecte", "mois", "semaine"],
        )
        element_raw = mapped_submission_value(
            calculation_source,
            payload,
            "element",
            ["element_id", "element", "variable", "rubrique", "donnees_a_collecter", "indicateur_financier", "indicateur_wfm", "parametre"],
        )
        value_raw = mapped_submission_value(
            calculation_source,
            payload,
            "value",
            ["valeur_element", "value", "valeur", "valeur_j", "valeur_du_jour_j", "score", "resultat"],
        )
        branch_raw = mapped_submission_value(calculation_source, payload, "branch", ["filiale", "branch", "pays"])
        validation_raw = mapped_submission_value(
            calculation_source,
            payload,
            "validation",
            ["validation_hierarchique", "validation_status"],
        )

        kpi_key = normalize_match_key(kpi_raw or row["kpi_name"])
        period_label = text_or_empty(period_raw or row["period"] or "Periode non renseignee")
        if not pole_id or not kpi_key:
            quality["warnings"].append("Ligne de donnees ignoree: pole ou KPI non reconnu.")
            continue

        period_date = parse_daily_period_date(period_label)
        kpi_raw_text = text_or_empty(kpi_raw or row["kpi_name"])
        element = {
            "label": text_or_empty(element_raw or "valeur"),
            "value": value_raw if value_raw not in (None, "") else row["value"],
            "branch": text_or_empty(branch_raw or row["branch"]),
            "validation": text_or_empty(validation_raw or row["validation_status"]),
        }
        calculation_entries.append(
            {
                "poleId": pole_id,
                "kpiKey": kpi_key,
                "kpiRaw": kpi_raw_text,
                "periodDate": period_date,
                "element": element,
            }
        )
        if period_date:
            upsert_kpi_daily_data(
                conn,
                data_date=period_date,
                pole_id=pole_id,
                branch=text_or_empty(branch_raw or row["branch"]),
                kpi_key=kpi_key,
                kpi_raw=kpi_raw_text,
                element_label=element["label"],
                raw_value=element["value"],
                validation_status=element["validation"],
                source_form_uid=calculation_source["formId"],
                source_submission_uid=text_or_empty(row["submission_uid"] or str(row["id"])),
                submitted_at=text_or_empty(row["submitted_at"]),
                collector=text_or_empty(row["collector"]),
                raw_payload_json=text_or_empty(row["raw_payload_json"]),
            )
        add_calculation_group(
            pole_id,
            kpi_key,
            kpi_raw_text,
            period_label,
            element,
            period_start=period_date.isoformat() if period_date else "",
            period_end=period_date.isoformat() if period_date else "",
            period_type="day" if period_date else "period",
        )

    quality["calculationGroups"] = len(groups)

    dated_entries = [entry for entry in calculation_entries if entry["periodDate"]]
    scope_dates: dict[tuple[str, str], set[dt.date]] = {}
    for entry in dated_entries:
        scope_dates.setdefault((entry["poleId"], entry["kpiKey"]), set()).add(entry["periodDate"])

    for (pole_id, kpi_key), target_dates in scope_dates.items():
        scoped_entries = [
            entry
            for entry in dated_entries
            if entry["poleId"] == pole_id and entry["kpiKey"] == kpi_key
        ]
        for target_date in sorted(target_dates):
            start_date = target_date.replace(day=1)
            month_elements = [
                entry
                for entry in scoped_entries
                if entry["periodDate"].year == target_date.year
                and entry["periodDate"].month == target_date.month
                and start_date <= entry["periodDate"] <= target_date
            ]
            if not month_elements:
                continue
            sample = month_elements[0]
            for entry in month_elements:
                add_calculation_group(
                    pole_id,
                    kpi_key,
                    sample["kpiRaw"],
                    month_to_date_label(target_date),
                    entry["element"],
                    group_period_key=f"month-to-date-{target_date.isoformat()}",
                    period_start=start_date.isoformat(),
                    period_end=target_date.isoformat(),
                    period_type="monthToDate",
                )

    results: list[dict] = []
    pole_names = {row["id"]: row["name"] for row in conn.execute("SELECT id, name FROM poles").fetchall()}
    quality["referenceKpis"] = sorted(
        [
            {
                "id": f"{record['poleId']}:{record['kpiId']}",
                "poleId": record["poleId"],
                "poleName": pole_names.get(record["poleId"], record["poleId"]),
                "kpiId": record["kpiId"],
                "kpiName": record["kpiName"],
                "target": record["target"] or "A completer",
                "unit": record["unit"],
                "formula": record["formula"] or "Formule a completer",
                "source": reference_source["formId"],
                "sourceData": record["sourceData"],
                "owner": record["owner"],
                "collectionFrequency": record["collectionFrequency"],
                "reportingFrequency": record["reportingFrequency"],
                "status": "gray",
                "valueLabel": "En attente calcul",
                "method": "Reference Kobo, donnees de calcul attendues",
            }
            for record in references
        ],
        key=lambda item: (item["poleName"], item["kpiName"]),
    )

    for group in groups.values():
        is_month_to_date = group.get("periodType") == "monthToDate"
        reference = reference_lookup.get((group["poleId"], group["kpiKey"])) or reference_by_kpi.get(group["kpiKey"])
        if not reference:
            if not is_month_to_date:
                quality["unmatchedCalculationCount"] += 1
            continue

        if not is_month_to_date:
            quality["matchedCalculationGroups"] += 1
        value, method, formula_warnings = evaluate_kpi_formula(reference["formula"], group["elements"])
        if value is None:
            if not is_month_to_date:
                quality["uncalculatedCount"] += 1
                quality["warnings"].extend(formula_warnings[:1])
            continue

        status = rag_status(value, reference["target"], reference["kpiName"], reference["formula"])
        result = {
            "id": f"{group['poleId']}:{reference['kpiId']}:{normalize_submission_key(group['period'])}",
            "poleId": group["poleId"],
            "poleName": pole_names.get(group["poleId"], group["poleId"]),
            "kpiId": reference["kpiId"],
            "kpiName": reference["kpiName"],
            "period": group["period"],
            "periodStart": group.get("periodStart") or "",
            "periodEnd": group.get("periodEnd") or "",
            "periodType": group.get("periodType") or "period",
            "value": round(value, 4),
            "valueLabel": format_calculated_value(value, reference["unit"]),
            "target": reference["target"] or "A completer",
            "unit": reference["unit"],
            "status": status,
            "trend": "Calcul Kobo",
            "source": calculation_source["formId"] if calculation_source else reference_source["formId"],
            "formula": reference["formula"] or "Formule a completer",
            "sourceData": reference["sourceData"],
            "method": method,
            "elementsCount": len(group["elements"]),
            "warnings": formula_warnings,
        }
        results.append(result)

    exact_results = [result for result in results if result.get("periodType") != "monthToDate"]
    quality["calculatedCount"] = len(exact_results)
    quality["monthToDateCount"] = len(results) - len(exact_results)
    if calculation_source:
        row = conn.execute(
            "SELECT COUNT(*) AS daily_count FROM kpi_daily_data WHERE source_form_uid = ?",
            (calculation_source["formId"],),
        ).fetchone()
        quality["dailyDataRows"] = int(row["daily_count"] if row else 0)
    if quality["calculationGroups"]:
        quality["matchRate"] = round((quality["matchedCalculationGroups"] / quality["calculationGroups"]) * 100)
        quality["calculationRate"] = round((quality["calculatedCount"] / quality["calculationGroups"]) * 100)
    if quality["calculationGroups"]:
        quality["calculationRate"] = round((quality["calculatedCount"] / quality["calculationGroups"]) * 100)

    if quality["unmatchedCalculationCount"]:
        quality["proposals"].append(
            "Uniformiser les champs pole_id, id_kpi et periode_reporting dans les deux formulaires pour supprimer les ecarts."
        )
    if quality["missingTargetCount"]:
        quality["proposals"].append("Completer les valeurs cibles dans le formulaire KPI/formules pour fiabiliser le statut vert/orange/rouge.")
    if quality["missingFormulaCount"]:
        quality["proposals"].append("Formaliser les formules restantes avec les memes libelles que les elements collectes.")
    if references and not calculation_source:
        quality["proposals"].append("Les KPI du referentiel sont visibles; ajouter le formulaire donnees de calcul pour obtenir les valeurs.")
    if not results and quality["configured"]:
        quality["proposals"].append("Synchroniser le formulaire donnees de calcul pour remplacer les valeurs en attente.")
    if not quality["proposals"]:
        quality["proposals"].append("Maintenir le meme id_kpi dans les deux formulaires pour garder le calcul automatique stable.")

    unique_warnings = []
    for warning in quality["warnings"]:
        if warning and warning not in unique_warnings:
            unique_warnings.append(warning)
    quality["warnings"] = unique_warnings[:8]
    return sorted(results, key=lambda item: (item["poleName"], item["kpiName"], item["period"])), quality


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
        existing_form = conn.execute(
            """
            SELECT id, source_type
            FROM kobo_forms
            WHERE uid = ?
            """,
            (form_uid,),
        ).fetchone()
        source_type = "Connexion KoboToolbox"
        existing_mappings: dict[str, str | None] = {}
        if existing_form:
            existing_role = kobo_source_role(existing_form["source_type"])
            if existing_role != "autre":
                source_type = existing_form["source_type"]
            existing_mappings = {
                row["field_name"]: row["mapped_to"]
                for row in conn.execute(
                    """
                    SELECT field_name, mapped_to
                    FROM kobo_form_fields
                    WHERE form_id = ?
                    """,
                    (existing_form["id"],),
                ).fetchall()
            }
        conn.execute(
            """
            INSERT INTO kobo_forms (uid, title, server_url, source_type, status, updated_at)
            VALUES (?, ?, ?, ?, 'Connecte', CURRENT_TIMESTAMP)
            ON CONFLICT(uid) DO UPDATE SET
              title = excluded.title,
              server_url = excluded.server_url,
              source_type = excluded.source_type,
              status = excluded.status,
              updated_at = CURRENT_TIMESTAMP
            """,
            (form_uid, form_title, server_url, source_type),
        )
        form_id = conn.execute("SELECT id FROM kobo_forms WHERE uid = ?", (form_uid,)).fetchone()["id"]
        conn.execute("DELETE FROM kobo_form_fields WHERE form_id = ?", (form_id,))
        for field in fields:
            conn.execute(
                """
                INSERT INTO kobo_form_fields (form_id, field_name, field_label, field_type, mapped_to)
                VALUES (?, ?, ?, ?, ?)
                """,
                (form_id, field["name"], field["label"], field["type"], existing_mappings.get(field["name"])),
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
        kpi_results, kpi_quality = calculate_kpi_results(conn)

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
        "kpiCalculationResults": kpi_results,
        "kpiCalculationQuality": kpi_quality,
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
