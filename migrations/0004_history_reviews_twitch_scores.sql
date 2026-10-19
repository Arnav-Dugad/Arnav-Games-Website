-- Steam review totals, sampled hourly for games around launch (review velocity).
CREATE TABLE IF NOT EXISTS review_history (
  app_id      INTEGER NOT NULL,          -- Steam app id
  hour        INTEGER NOT NULL,          -- unix seconds, truncated to the hour
  total       INTEGER NOT NULL,
  positive    INTEGER NOT NULL,
  PRIMARY KEY (app_id, hour)
);

-- Twitch viewers across a game's top streams, sampled by cron.
CREATE TABLE IF NOT EXISTS twitch_history (
  twitch_id   TEXT    NOT NULL,          -- Twitch category (game) id
  hour        INTEGER NOT NULL,          -- unix seconds, truncated to the hour
  viewers     INTEGER NOT NULL,
  streams     INTEGER NOT NULL,
  PRIMARY KEY (twitch_id, hour)
);

-- IGDB critic aggregate observed daily, so scores can be charted after launch.
CREATE TABLE IF NOT EXISTS score_history (
  game_id     INTEGER NOT NULL,          -- IGDB id
  observed_on TEXT    NOT NULL,          -- YYYY-MM-DD (UTC)
  score       REAL    NOT NULL,
  count       INTEGER NOT NULL,
  PRIMARY KEY (game_id, observed_on)
);

-- Twitch ids for tracked games, so the cron can sample without IGDB lookups.
ALTER TABLE tracked_games ADD COLUMN twitch TEXT;
