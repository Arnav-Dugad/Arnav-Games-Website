-- Local store prices observed for a game, one row per store/country/day.
-- Prices are integer minor units (cents, paise…) in the store's own currency.
CREATE TABLE IF NOT EXISTS price_history (
  game_id     INTEGER NOT NULL,          -- IGDB id
  store       TEXT    NOT NULL,          -- steam | microsoft
  country     TEXT    NOT NULL,          -- ISO 3166-1 alpha-2
  currency    TEXT    NOT NULL,          -- ISO 4217
  price       INTEGER NOT NULL,          -- current price, minor units
  initial     INTEGER,                   -- undiscounted price, minor units
  discount    INTEGER,                   -- percent off, 0–100
  observed_on TEXT    NOT NULL,          -- YYYY-MM-DD (UTC)
  PRIMARY KEY (game_id, store, country, observed_on)
);
CREATE INDEX IF NOT EXISTS idx_price_game ON price_history (game_id, country, observed_on);

-- Concurrent Steam players, sampled hourly by cron.
CREATE TABLE IF NOT EXISTS player_history (
  app_id      INTEGER NOT NULL,          -- Steam app id
  hour        INTEGER NOT NULL,          -- unix seconds, truncated to the hour
  players     INTEGER NOT NULL,
  PRIMARY KEY (app_id, hour)
);

-- Games the crons sample. Filled from trending/upcoming/popular shelves and
-- from game pages people actually visit.
CREATE TABLE IF NOT EXISTS tracked_games (
  game_id     INTEGER PRIMARY KEY,
  slug        TEXT    NOT NULL,
  steam_app   INTEGER,
  microsoft   TEXT,
  last_seen   INTEGER NOT NULL           -- unix seconds
);

-- Search aliases: zero-result queries the owner maps to a game ("botw").
CREATE TABLE IF NOT EXISTS search_aliases (
  alias       TEXT    PRIMARY KEY,       -- normalised lowercase query
  game_id     INTEGER,
  slug        TEXT,
  name        TEXT,
  status      TEXT    NOT NULL DEFAULT 'suggested', -- suggested | approved | dismissed
  hits        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Analytics extensions: cookieless retention cohorts and attribution.
ALTER TABLE analytics_events ADD COLUMN cohort TEXT;   -- ISO week of first visit, from localStorage
ALTER TABLE analytics_events ADD COLUMN visit TEXT;    -- new | return (first pageview of a day only)
ALTER TABLE analytics_events ADD COLUMN src TEXT;      -- shelf/rail that led to a follow/signup
