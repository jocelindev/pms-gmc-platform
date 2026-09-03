from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT_DIR / "database" / "pms_gmc.sqlite"
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from database.db import is_postgres_enabled


def ensure_database(db_path: Path) -> None:
    if not is_postgres_enabled() and db_path.exists():
        return

    if not is_postgres_enabled():
        db_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [sys.executable, str(ROOT_DIR / "database" / "init_database.py"), "--db", str(db_path)],
        cwd=ROOT_DIR,
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Demarre Palladium Africa Hub central avec initialisation de base si necessaire.")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", default=os.environ.get("PORT", "5184"))
    parser.add_argument("--db", default=os.environ.get("PMS_DB_PATH", str(DEFAULT_DB_PATH)))
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    ensure_database(db_path)

    if not is_postgres_enabled():
        os.environ["PMS_DB_PATH"] = str(db_path)
    command = [
        sys.executable,
        str(ROOT_DIR / "server.py"),
        "--host",
        str(args.host),
        "--port",
        str(args.port),
    ]
    if not is_postgres_enabled():
        command.extend(["--db", str(db_path)])
    raise SystemExit(subprocess.call(command, cwd=ROOT_DIR))


if __name__ == "__main__":
    main()
