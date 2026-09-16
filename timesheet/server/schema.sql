-- Esquema do sistema de timesheet — Azeredo & Ugatti Advogados
-- Convenções:
--   * valores monetários são inteiros em CENTAVOS (evita erro de ponto flutuante)
--   * durações são inteiros em MINUTOS
--   * datas de competência são TEXT no formato ISO 'YYYY-MM-DD'
--   * carimbos de tempo são TEXT ISO-8601 em UTC

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  email             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash     TEXT    NOT NULL,
  role              TEXT    NOT NULL CHECK (role IN ('master','user')),
  oab               TEXT,
  hourly_rate_cents INTEGER CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents >= 0),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  document    TEXT,                       -- CNPJ ou CPF (somente dígitos)
  email       TEXT,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_name ON clients(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS projects (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id          INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name               TEXT    NOT NULL,
  code               TEXT,                -- referência interna / nº do processo
  billing_type       TEXT    NOT NULL DEFAULT 'hourly'
                             CHECK (billing_type IN ('hourly','fixed','pro_bono')),
  default_rate_cents INTEGER CHECK (default_rate_cents IS NULL OR default_rate_cents >= 0),
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_client_name
  ON projects(client_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);

-- Lançamentos de horas.
-- rate_cents guarda o VALOR/HORA CONGELADO no momento do lançamento: alterar a
-- tabela de honorários de um profissional ou projeto nunca reescreve o passado.
CREATE TABLE IF NOT EXISTS time_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  work_date    TEXT    NOT NULL,
  minutes      INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  description  TEXT    NOT NULL,
  billable     INTEGER NOT NULL DEFAULT 1 CHECK (billable IN (0,1)),
  rate_cents   INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents >= 0),
  invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user_date  ON time_entries(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_entries_project    ON time_entries(project_id, work_date);
CREATE INDEX IF NOT EXISTS idx_entries_date       ON time_entries(work_date);
CREATE INDEX IF NOT EXISTS idx_entries_invoice    ON time_entries(invoice_id);

-- Fechamentos: congelam um conjunto de lançamentos para emissão de nota fiscal.
-- Lançamentos com invoice_id preenchido ficam bloqueados para edição/exclusão.
CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  reference     TEXT    NOT NULL,          -- ex.: "2026-09" ou "NF 1234"
  period_start  TEXT    NOT NULL,
  period_end    TEXT    NOT NULL,
  total_minutes INTEGER NOT NULL DEFAULT 0,
  total_cents   INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'closed'
                        CHECK (status IN ('closed','invoiced','cancelled')),
  notes         TEXT,
  created_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id, period_start);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT    PRIMARY KEY,         -- SHA-256 do token; o token cru só existe no cookie
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Trilha de auditoria: exigida na prática para provar quem lançou/excluiu horas
-- faturadas, e útil para o princípio da responsabilização da LGPD (art. 6º, X).
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT    NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT    NOT NULL,          -- create | update | delete | login | ...
  entity        TEXT    NOT NULL,          -- time_entry | client | project | user | ...
  entity_id     INTEGER,
  details       TEXT                       -- JSON
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at     ON audit_log(at);

CREATE TABLE IF NOT EXISTS login_attempts (
  email       TEXT NOT NULL,
  at          TEXT NOT NULL,
  ok          INTEGER NOT NULL CHECK (ok IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(email, at);
