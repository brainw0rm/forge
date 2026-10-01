-- Change alerts: users watch a class or a saved build and get emailed when its talents change.

CREATE TABLE watches (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('class', 'build')),
  target     TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, target)
);
CREATE INDEX watches_target ON watches(kind, target);

-- Small key/value store for jobs, e.g. the last beta build alerts were sent for.
CREATE TABLE job_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
