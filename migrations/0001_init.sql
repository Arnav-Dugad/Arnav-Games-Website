-- Release-date history: one row per distinct date/window we have seen for a
-- game. A delay is any later row whose value differs from the previous one.
CREATE TABLE IF NOT EXISTS release_observations (
  game_id     INTEGER NOT NULL,
  slug        TEXT    NOT NULL,
  -- ISO YYYY-MM-DD when day-precise, otherwise the window label ("Q4 2026").
  value       TEXT    NOT NULL,
  observed_at INTEGER NOT NULL, -- unix seconds
  PRIMARY KEY (game_id, value)
);
CREATE INDEX IF NOT EXISTS idx_release_obs_game ON release_observations (game_id, observed_at);

-- First-party, cookieless analytics. No IPs or user ids are stored.
CREATE TABLE IF NOT EXISTS analytics_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,           -- unix seconds
  type        TEXT    NOT NULL,           -- pageview | search | follow | own | signup | vital
  path        TEXT,
  ref_host    TEXT,
  country     TEXT,
  device      TEXT,                       -- mobile | tablet | desktop
  game_slug   TEXT,
  query       TEXT,
  results     INTEGER,
  value       REAL,                       -- metric value (e.g. LCP ms)
  name        TEXT                        -- metric name (LCP, INP, CLS)
);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON analytics_events (ts);
CREATE INDEX IF NOT EXISTS idx_events_type ON analytics_events (type, ts);
