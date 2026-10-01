-- Accounts, sessions, saved builds and ratings.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Only a SHA-256 of the session token is stored; the token itself lives in the cookie.
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE builds (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class       TEXT    NOT NULL,
  code        TEXT    NOT NULL,
  split       TEXT    NOT NULL,
  points      INTEGER NOT NULL,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  is_public   INTEGER NOT NULL DEFAULT 1,
  game_build  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX builds_public ON builds(is_public, class, created_at);
CREATE INDEX builds_user ON builds(user_id);

CREATE TABLE ratings (
  build_id   TEXT    NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (build_id, user_id)
);

-- Sliding-window rate limit for login/signup, keyed by client IP.
CREATE TABLE auth_attempts (
  ip TEXT    NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX auth_attempts_ip ON auth_attempts(ip, at);
