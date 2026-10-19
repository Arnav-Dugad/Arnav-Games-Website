-- Weekly owner digest: every build is kept so /admin can show the latest one
-- (with its delivery outcome) even when no email provider is configured.
CREATE TABLE IF NOT EXISTS analytics_digests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL,          -- scheduled | test
  created_at   INTEGER NOT NULL,          -- unix seconds
  period_start INTEGER NOT NULL,          -- unix seconds, inclusive
  period_end   INTEGER NOT NULL,          -- unix seconds, inclusive
  subject      TEXT    NOT NULL,
  html         TEXT    NOT NULL,
  text         TEXT    NOT NULL,
  delivery     TEXT    NOT NULL,          -- sent | not-configured | failed
  recipients   INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_digests_created ON analytics_digests (created_at);

-- Search-alias autopilot: the approved game's cover, and the candidate games
-- proposed for a suggestion (JSON array), cached so IGDB is asked once.
ALTER TABLE search_aliases ADD COLUMN image TEXT;
ALTER TABLE search_aliases ADD COLUMN candidates TEXT;
ALTER TABLE search_aliases ADD COLUMN candidates_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_aliases_status ON search_aliases (status, hits);
