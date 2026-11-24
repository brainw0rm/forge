-- "Where did you find it?": players report where they got a recipe in WoW Forever. A report is shown on
-- the recipe page once the site operator approves it (signed link in the notification email).

CREATE TABLE source_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  prof        TEXT    NOT NULL,
  spell       INTEGER NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('drop', 'vendor', 'quest', 'trainer', 'container', 'other')),
  place       TEXT    NOT NULL,
  zone        TEXT    NOT NULL DEFAULT '',
  note        TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE INDEX source_reports_recipe ON source_reports(prof, spell, status);
