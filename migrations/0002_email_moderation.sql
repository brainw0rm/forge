-- Email verification, password reset, roles, and build reports/moderation.

ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Hidden builds are only visible to their owner and to admins.
ALTER TABLE builds ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

-- One-time links sent by email. Only a SHA-256 of the token is stored.
CREATE TABLE email_tokens (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT    NOT NULL CHECK (purpose IN ('verify', 'reset')),
  email      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);

CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  build_id    TEXT    NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT    NOT NULL,
  details     TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution  TEXT
);
-- A user can have only one open report per build.
CREATE UNIQUE INDEX reports_open_unique ON reports(build_id, reporter_id) WHERE resolved_at IS NULL;
CREATE INDEX reports_open ON reports(resolved_at, build_id);

-- Local development only: outgoing mail is stored here instead of being sent
-- (enabled by the DEV_MAIL_OUTBOX binding; unused in production).
CREATE TABLE dev_outbox (
  id         INTEGER PRIMARY KEY,
  to_addr    TEXT    NOT NULL,
  subject    TEXT    NOT NULL,
  text       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
