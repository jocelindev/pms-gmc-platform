PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS profile_permissions (
  profile_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0 CHECK (allowed IN (0, 1)),
  PRIMARY KEY (profile_id, permission_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS poles (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  owner TEXT,
  kpi_count INTEGER DEFAULT 0,
  score REAL DEFAULT 0,
  rag TEXT DEFAULT 'gray',
  quality REAL DEFAULT 0,
  last_report TEXT,
  status TEXT,
  late_submissions INTEGER DEFAULT 0,
  action_count INTEGER DEFAULT 0,
  readiness REAL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  default_profile_id INTEGER,
  status TEXT NOT NULL DEFAULT 'Actif',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (default_profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS user_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pole_id TEXT NOT NULL,
  profile_id INTEGER NOT NULL,
  dashboard_scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Actif',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, pole_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (pole_id) REFERENCES poles(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS kpis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  pole_id TEXT NOT NULL,
  name TEXT NOT NULL,
  definition TEXT,
  type TEXT,
  unit TEXT,
  formula TEXT,
  target TEXT,
  current_value TEXT,
  trend TEXT,
  rag_status TEXT DEFAULT 'gray',
  collection_frequency TEXT,
  reporting_frequency TEXT,
  data_source TEXT,
  source_form_uid TEXT,
  responsible TEXT,
  respondent TEXT,
  validator TEXT,
  document_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pole_id) REFERENCES poles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kpi_objectives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_id INTEGER NOT NULL,
  pole_id TEXT NOT NULL,
  period TEXT NOT NULL,
  target TEXT NOT NULL,
  unit TEXT,
  frequency TEXT,
  source_form_uid TEXT,
  source_server_url TEXT,
  source_data TEXT,
  responsible TEXT,
  validation_status TEXT DEFAULT 'A valider',
  document_status TEXT,
  attention_points TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kpi_id, pole_id, period),
  FOREIGN KEY (kpi_id) REFERENCES kpis(id) ON DELETE CASCADE,
  FOREIGN KEY (pole_id) REFERENCES poles(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS kobo_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  server_url TEXT,
  cadence TEXT,
  source_type TEXT NOT NULL DEFAULT 'KoboCollect',
  status TEXT NOT NULL DEFAULT 'Actif',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kobo_form_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  field_label TEXT,
  field_type TEXT,
  mapped_to TEXT,
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  UNIQUE (form_id, field_name),
  FOREIGN KEY (form_id) REFERENCES kobo_forms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kobo_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_uid TEXT NOT NULL,
  pole_id TEXT,
  branch TEXT,
  kpi_name TEXT,
  collector TEXT,
  submitted_at TEXT,
  period TEXT,
  value TEXT,
  validation_status TEXT NOT NULL DEFAULT 'A valider',
  raw_payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pole_id) REFERENCES poles(id)
);

CREATE TABLE IF NOT EXISTS validation_queue (
  id TEXT PRIMARY KEY,
  form_uid TEXT,
  pole_id TEXT,
  issue TEXT NOT NULL,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'A traiter',
  class_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pole_id) REFERENCES poles(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  pole_id TEXT NOT NULL,
  cycle TEXT NOT NULL,
  period TEXT NOT NULL,
  format TEXT DEFAULT 'PDF',
  status TEXT NOT NULL DEFAULT 'Brouillon',
  owner TEXT,
  generated_at TEXT,
  due_at TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pole_id) REFERENCES poles(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  scope TEXT,
  detail TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  status TEXT NOT NULL DEFAULT 'Non lu',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_access_user ON user_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_access_pole ON user_access(pole_id);
CREATE INDEX IF NOT EXISTS idx_kpis_pole ON kpis(pole_id);
CREATE INDEX IF NOT EXISTS idx_objectives_period ON kpi_objectives(period);
CREATE INDEX IF NOT EXISTS idx_kobo_submissions_form ON kobo_submissions(form_uid);
CREATE INDEX IF NOT EXISTS idx_reports_pole_period ON reports(pole_id, period);

CREATE VIEW IF NOT EXISTS v_user_access_details AS
SELECT
  ua.id,
  u.full_name AS responsible,
  u.email,
  p.id AS pole_id,
  p.name AS pole_name,
  pr.name AS profile,
  ua.dashboard_scope,
  ua.status
FROM user_access ua
JOIN users u ON u.id = ua.user_id
JOIN poles p ON p.id = ua.pole_id
JOIN profiles pr ON pr.id = ua.profile_id;

CREATE VIEW IF NOT EXISTS v_profile_permissions_matrix AS
SELECT
  pr.name AS profile,
  pe.code AS permission,
  pp.allowed AS allowed
FROM profile_permissions pp
JOIN profiles pr ON pr.id = pp.profile_id
JOIN permissions pe ON pe.id = pp.permission_id;

CREATE VIEW IF NOT EXISTS v_kpi_dashboard_by_pole AS
SELECT
  p.id AS pole_id,
  p.name AS pole_name,
  COUNT(k.id) AS total_kpi,
  SUM(CASE WHEN k.rag_status = 'green' THEN 1 ELSE 0 END) AS green_kpi,
  SUM(CASE WHEN k.rag_status = 'amber' THEN 1 ELSE 0 END) AS amber_kpi,
  SUM(CASE WHEN k.rag_status = 'red' THEN 1 ELSE 0 END) AS red_kpi
FROM poles p
LEFT JOIN kpis k ON k.pole_id = p.id
GROUP BY p.id, p.name;
