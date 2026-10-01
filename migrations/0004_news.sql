-- News headlines about WoW Forever from publishers' public RSS/Atom feeds.
-- Only what's needed to link to the original article is stored: no text, no images.

CREATE TABLE news_items (
  url          TEXT    PRIMARY KEY,
  source       TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  published_at INTEGER NOT NULL,
  first_seen   INTEGER NOT NULL,
  -- Set by moderators, e.g. on a publisher's request; hidden items are never re-shown.
  hidden       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX news_items_published ON news_items(hidden, published_at DESC);
