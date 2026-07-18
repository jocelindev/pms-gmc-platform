from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import unicodedata
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DATABASE_DIR = ROOT_DIR / "database"
SCHEMA_PATH = DATABASE_DIR / "schema.sql"
DEFAULT_DB_PATH = DATABASE_DIR / "pms_gmc.sqlite"
PASSWORD_ITERATIONS = 210_000
DEFAULT_ADMIN_PASSWORD = os.environ.get("PMS_ADMIN_PASSWORD", "Admin@2026!")
DEFAULT_USER_PASSWORD = os.environ.get("PMS_DEFAULT_USER_PASSWORD", "Palladium@2026!")


PERMISSIONS = [
    ("consultation", "Consultation", "Voir les tableaux de bord, KPI, rapports et donnees."),
    ("ajout", "Ajout", "Creer des objectifs, rapports, donnees ou affectations."),
    ("modification", "Modification", "Modifier les informations existantes."),
    ("suppression", "Suppression", "Supprimer des donnees ou configurations."),
    ("validation", "Validation", "Valider les KPI, rapports et donnees consolidees."),
    ("administration", "Administration", "Gerer les utilisateurs, profils et droits."),
]


PROFILE_PERMISSIONS = {
    "Administrateur": {
        "consultation": True,
        "ajout": True,
        "modification": True,
        "suppression": True,
        "validation": True,
        "administration": True,
    },
    "Direction": {
        "consultation": True,
        "ajout": False,
        "modification": False,
        "suppression": False,
        "validation": True,
        "administration": False,
    },
    "Manager / Responsable": {
        "consultation": True,
        "ajout": True,
        "modification": True,
        "suppression": False,
        "validation": True,
        "administration": False,
    },
    "Analyste BI": {
        "consultation": True,
        "ajout": True,
        "modification": True,
        "suppression": False,
        "validation": False,
        "administration": False,
    },
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


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", ".", ascii_value.lower()).strip(".")
    return slug or "utilisateur"


def find_node_executable() -> str | None:
    env_node = os.environ.get("NODE_EXE")
    if env_node and Path(env_node).exists():
        return env_node

    path_node = shutil.which("node")
    if path_node:
        return path_node

    bundled = (
        Path.home()
        / ".cache"
        / "codex-runtimes"
        / "codex-primary-runtime"
        / "dependencies"
        / "node"
        / "bin"
        / ("node.exe" if os.name == "nt" else "node")
    )
    if bundled.exists():
        return str(bundled)

    return None


def load_frontend_data() -> dict:
    node = find_node_executable()
    if not node:
        print("Aucun Node.js trouve: initialisation minimale.", file=sys.stderr)
        return {}

    data_js = ROOT_DIR / "scripts" / "data.js"
    code = (
        "globalThis.window = {};\n"
        f"await import({json.dumps(data_js.as_uri())});\n"
        "process.stdout.write(JSON.stringify(globalThis.window.PMS_DATA || {}));\n"
    )
    result = subprocess.run(
        [node, "--input-type=module", "-e", code],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        print(result.stderr.strip(), file=sys.stderr)
        print("Impossible de lire scripts/data.js: initialisation minimale.", file=sys.stderr)
        return {}
    return json.loads(result.stdout or "{}")


def upsert_profile(cur: sqlite3.Cursor, name: str, description: str | None = None) -> int:
    cur.execute(
        """
        INSERT INTO profiles (name, description)
        VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET description = excluded.description
        """,
        (name, description),
    )
    cur.execute("SELECT id FROM profiles WHERE name = ?", (name,))
    return int(cur.fetchone()[0])


def upsert_permission(cur: sqlite3.Cursor, code: str, label: str, description: str) -> int:
    cur.execute(
        """
        INSERT INTO permissions (code, label, description)
        VALUES (?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          label = excluded.label,
          description = excluded.description
        """,
        (code, label, description),
    )
    cur.execute("SELECT id FROM permissions WHERE code = ?", (code,))
    return int(cur.fetchone()[0])


def upsert_user(
    cur: sqlite3.Cursor,
    full_name: str,
    profile_id: int | None = None,
    initial_password: str | None = None,
) -> int:
    email = f"{slugify(full_name)}@palladium.local"
    password_hash = hash_password(initial_password or DEFAULT_USER_PASSWORD)
    cur.execute(
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
    cur.execute("SELECT id FROM users WHERE email = ?", (email,))
    return int(cur.fetchone()[0])


def upsert_pole(cur: sqlite3.Cursor, pole: dict) -> None:
    cur.execute(
        """
        INSERT INTO poles (
          id, category, name, owner, kpi_count, score, rag, quality, last_report,
          status, late_submissions, action_count, readiness, note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          name = excluded.name,
          owner = excluded.owner,
          kpi_count = excluded.kpi_count,
          score = excluded.score,
          rag = excluded.rag,
          quality = excluded.quality,
          last_report = excluded.last_report,
          status = excluded.status,
          late_submissions = excluded.late_submissions,
          action_count = excluded.action_count,
          readiness = excluded.readiness,
          note = excluded.note
        """,
        (
            pole.get("id"),
            pole.get("category", "Non classe"),
            pole.get("name", pole.get("id", "Pole")),
            pole.get("owner"),
            pole.get("kpiCount", 0),
            pole.get("score", 0),
            pole.get("rag", "gray"),
            pole.get("quality", 0),
            pole.get("lastReport"),
            pole.get("status"),
            pole.get("lateSubmissions", 0),
            pole.get("actionCount", 0),
            pole.get("readiness", 0),
            pole.get("note"),
        ),
    )


def seed_database(conn: sqlite3.Connection, data: dict) -> None:
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys = ON")

    cur.execute(
        """
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('schema_version', '1.0.0', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        """
    )
    cur.execute(
        """
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES ('database_name', 'PMS GMC Group', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        """
    )

    permission_ids = {
        code: upsert_permission(cur, code, label, description)
        for code, label, description in PERMISSIONS
    }

    profile_ids = {}
    for profile, permissions in PROFILE_PERMISSIONS.items():
        profile_id = upsert_profile(cur, profile, f"Profil {profile}")
        profile_ids[profile] = profile_id
        for code, permission_id in permission_ids.items():
            cur.execute(
                """
                INSERT OR REPLACE INTO profile_permissions (profile_id, permission_id, allowed)
                VALUES (?, ?, ?)
                """,
                (profile_id, permission_id, 1 if permissions.get(code) else 0),
            )

    upsert_user(cur, "Administrateur PMS", profile_ids["Administrateur"], DEFAULT_ADMIN_PASSWORD)

    reporting = data.get("reporting", {})
    poles = list(reporting.get("poles", []))
    kpis_by_pole = reporting.get("kpisByPole", {})
    known_poles = {pole.get("id") for pole in poles}
    for pole_id in kpis_by_pole:
        if pole_id not in known_poles:
            poles.append(
                {
                    "id": pole_id,
                    "category": "Non classe",
                    "name": pole_id,
                    "owner": f"Responsable {pole_id}",
                    "kpiCount": len(kpis_by_pole.get(pole_id, [])),
                    "rag": "gray",
                    "status": "A completer",
                }
            )

    for pole in poles:
        upsert_pole(cur, pole)
        owner = pole.get("owner")
        if owner:
            user_id = upsert_user(cur, owner, profile_ids["Manager / Responsable"])
            cur.execute(
                """
                INSERT INTO user_access (user_id, pole_id, branch, profile_id, dashboard_scope, status, updated_at)
                VALUES (?, ?, 'Groupe', ?, ?, 'Actif', CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, pole_id, branch) DO UPDATE SET
                  profile_id = excluded.profile_id,
                  dashboard_scope = excluded.dashboard_scope,
                  status = 'Actif',
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    user_id,
                    pole.get("id"),
                    profile_ids["Manager / Responsable"],
                    f"Dashboard Suivi KPI - Groupe - {pole.get('name', pole.get('id'))}",
                ),
            )

    kpi_records = []
    for pole_id, kpis in kpis_by_pole.items():
        for index, kpi in enumerate(kpis, start=1):
            code = f"{pole_id}-{index:03d}"
            cur.execute(
                """
                INSERT INTO kpis (
                  code, pole_id, name, target, current_value, trend, rag_status,
                  source_form_uid, data_source, responsible, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(code) DO UPDATE SET
                  pole_id = excluded.pole_id,
                  name = excluded.name,
                  target = excluded.target,
                  current_value = excluded.current_value,
                  trend = excluded.trend,
                  rag_status = excluded.rag_status,
                  source_form_uid = excluded.source_form_uid,
                  data_source = excluded.data_source,
                  responsible = excluded.responsible,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    code,
                    pole_id,
                    kpi.get("name"),
                    kpi.get("target"),
                    kpi.get("value"),
                    kpi.get("trend"),
                    kpi.get("status", "gray"),
                    kpi.get("source"),
                    kpi.get("source"),
                    next((pole.get("owner") for pole in poles if pole.get("id") == pole_id), None),
                ),
            )
            kpi_records.append((pole_id, kpi.get("source")))

    for form in data.get("collectionForms", []):
        uid = form.get("code")
        if not uid:
            continue
        cur.execute(
            """
            INSERT INTO kobo_forms (uid, title, cadence, status, updated_at)
            VALUES (?, ?, ?, 'Actif', CURRENT_TIMESTAMP)
            ON CONFLICT(uid) DO UPDATE SET
              title = excluded.title,
              cadence = excluded.cadence,
              status = 'Actif',
              updated_at = CURRENT_TIMESTAMP
            """,
            (uid, form.get("title", uid), form.get("cadence")),
        )

    source_forms = {source for _, source in kpi_records if source}
    source_forms.update(item.get("form") for item in data.get("koboSubmissions", []) if item.get("form"))
    for uid in sorted(source_forms):
        cur.execute(
            """
            INSERT INTO kobo_forms (uid, title, status, updated_at)
            VALUES (?, ?, 'Actif', CURRENT_TIMESTAMP)
            ON CONFLICT(uid) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            """,
            (uid, uid),
        )

    required_fields = data.get("objectiveKoboTemplate", {}).get("requiredFields", [])
    if required_fields:
        cur.execute("SELECT id FROM kobo_forms WHERE uid = ?", ("OBJECTIFS-KPI",))
        row = cur.fetchone()
        if row is None:
            cur.execute(
                """
                INSERT INTO kobo_forms (uid, title, cadence, status)
                VALUES ('OBJECTIFS-KPI', 'Formulaire objectifs KPI', 'Selon periode', 'Actif')
                """
            )
            form_id = int(cur.lastrowid)
        else:
            form_id = int(row[0])

        for field in required_fields:
            cur.execute(
                """
                INSERT INTO kobo_form_fields (form_id, field_name, field_label, mapped_to, required)
                VALUES (?, ?, ?, ?, 1)
                ON CONFLICT(form_id, field_name) DO UPDATE SET
                  field_label = excluded.field_label,
                  mapped_to = excluded.mapped_to,
                  required = excluded.required
                """,
                (form_id, field.get("key"), field.get("label"), field.get("source")),
            )

    for item in data.get("koboSubmissions", []):
        cur.execute(
            """
            INSERT INTO kobo_submissions (
              form_uid, branch, kpi_name, collector, validation_status, raw_payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                item.get("form"),
                item.get("branch"),
                item.get("kpi"),
                item.get("collector"),
                item.get("status", "A valider"),
                json.dumps(item, ensure_ascii=False),
            ),
        )

    for item in data.get("validationQueue", []):
        cur.execute(
            """
            INSERT INTO validation_queue (id, form_uid, pole_id, issue, owner, status, class_name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              form_uid = excluded.form_uid,
              pole_id = excluded.pole_id,
              issue = excluded.issue,
              owner = excluded.owner,
              status = excluded.status,
              class_name = excluded.class_name
            """,
            (
                item.get("id"),
                item.get("form"),
                item.get("pole"),
                item.get("issue"),
                item.get("owner"),
                item.get("status"),
                item.get("className"),
            ),
        )

    for item in reporting.get("calendar", []):
        report_id = f"CAL-{item.get('pole')}-{slugify(item.get('cycle', 'cycle'))}-{slugify(item.get('period', 'period'))}"
        cur.execute(
            """
            INSERT INTO reports (id, pole_id, cycle, period, status, owner, due_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status = excluded.status,
              owner = excluded.owner,
              due_at = excluded.due_at
            """,
            (
                report_id,
                item.get("pole"),
                item.get("cycle"),
                item.get("period"),
                item.get("status"),
                item.get("owner"),
                item.get("due"),
            ),
        )

    for item in reporting.get("history", []):
        cur.execute(
            """
            INSERT INTO reports (id, pole_id, cycle, period, format, status, generated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              format = excluded.format,
              status = excluded.status,
              generated_at = excluded.generated_at
            """,
            (
                item.get("id"),
                item.get("pole"),
                item.get("cycle"),
                item.get("period"),
                item.get("format"),
                item.get("status"),
                item.get("generatedAt"),
            ),
        )

    for alert in data.get("alerts", []):
        cur.execute(
            """
            INSERT INTO notifications (title, scope, detail, level, status)
            VALUES (?, ?, ?, ?, 'Non lu')
            """,
            (
                alert.get("title"),
                alert.get("scope"),
                alert.get("detail"),
                alert.get("level", "info"),
            ),
        )

    for action in data.get("auditTrail", []):
        cur.execute(
            """
            INSERT INTO audit_logs (action, entity_type, details)
            VALUES (?, 'prototype', ?)
            """,
            ("import_audit_trail", action),
        )

    conn.commit()


def count_tables(conn: sqlite3.Connection) -> dict[str, int]:
    tables = [
        "profiles",
        "permissions",
        "poles",
        "users",
        "user_access",
        "kpis",
        "kpi_objectives",
        "kobo_forms",
        "kobo_form_fields",
        "kobo_submissions",
        "validation_queue",
        "reports",
        "notifications",
        "audit_logs",
    ]
    counts = {}
    for table in tables:
        counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialise la base SQLite PMS GMC Group.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Chemin du fichier SQLite.")
    parser.add_argument("--reset", action="store_true", help="Supprime et recree la base.")
    args = parser.parse_args()

    db_path = args.db.resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if args.reset and db_path.exists():
        db_path.unlink()

    data = load_frontend_data()
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        seed_database(conn, data)
        counts = count_tables(conn)
    finally:
        conn.close()

    print(f"Base creee: {db_path}")
    print(json.dumps(counts, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
