CREATE TABLE IF NOT EXISTS players (
  openid TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  best_score INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS players_best_score ON players (best_score DESC);