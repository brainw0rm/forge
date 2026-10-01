-- Bug reports and data corrections sent with the "Report a bug" form.

CREATE TABLE feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL CHECK (kind IN ('bug', 'data', 'idea')),
  message     TEXT    NOT NULL,
  page        TEXT    NOT NULL,
  -- Browser, screen size and game build at the time of the report (JSON), to reproduce problems.
  context     TEXT    NOT NULL,
  email       TEXT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX feedback_open ON feedback(resolved_at, created_at DESC);
