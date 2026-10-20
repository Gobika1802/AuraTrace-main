-- AuraTrace initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip         TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS monitors (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  url                  TEXT NOT NULL,
  type                 TEXT NOT NULL DEFAULT 'http' CHECK (type IN ('http')),
  interval_seconds     INTEGER NOT NULL DEFAULT 60 CHECK (interval_seconds BETWEEN 10 AND 86400),
  timeout_ms           INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 120000),
  expected_status      INTEGER,
  failure_threshold    INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold BETWEEN 1 AND 10),
  recovery_threshold   INTEGER NOT NULL DEFAULT 2 CHECK (recovery_threshold BETWEEN 1 AND 10),
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'up', 'down')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  last_checked_at      TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  last_failure_at      TIMESTAMPTZ,
  last_response_time_ms INTEGER,
  last_status_code     INTEGER,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitors_user_id_idx ON monitors(user_id);
CREATE INDEX IF NOT EXISTS monitors_due_idx ON monitors(active, last_checked_at);
CREATE UNIQUE INDEX IF NOT EXISTS monitors_user_url_unique ON monitors(user_id, lower(url), name);

CREATE TABLE IF NOT EXISTS monitor_checks (
  id               BIGSERIAL PRIMARY KEY,
  monitor_id       UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  success          BOOLEAN NOT NULL,
  status_code      INTEGER,
  response_time_ms INTEGER,
  error            TEXT,
  error_type       TEXT CHECK (error_type IN ('http_status', 'timeout', 'connection', 'dns', 'tls', 'blocked', 'internal')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitor_checks_monitor_time_idx ON monitor_checks(monitor_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id       UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  recovered_at     TIMESTAMPTZ,
  duration_seconds INTEGER,
  status           TEXT NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'resolved')),
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_user_idx ON incidents(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS incidents_monitor_idx ON incidents(monitor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS incidents_ongoing_idx ON incidents(monitor_id) WHERE status = 'ongoing';

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  notify_down       BOOLEAN NOT NULL DEFAULT TRUE,
  notify_recovery   BOOLEAN NOT NULL DEFAULT TRUE,
  recipient_email   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monitor_id   UUID REFERENCES monitors(id) ON DELETE CASCADE,
  incident_id  UUID REFERENCES incidents(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN ('down', 'recovery', 'test')),
  channel      TEXT NOT NULL DEFAULT 'email',
  status       TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  recipient    TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_logs_user_idx ON notification_logs(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notification_logs_incident_event_unique
  ON notification_logs(incident_id, event_type) WHERE incident_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS status_pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  published   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_pages_user_idx ON status_pages(user_id);

CREATE TABLE IF NOT EXISTS status_page_monitors (
  status_page_id UUID NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  monitor_id     UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (status_page_id, monitor_id)
);
