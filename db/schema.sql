CREATE TABLE IF NOT EXISTS players (
  openid TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  best_score INTEGER NOT NULL DEFAULT 0,
  points REAL NOT NULL DEFAULT 0,
  -- 新注册就送 3 次鹰眼，和 worker 里的 EAGLE_EYE_INITIAL_COUNT 保持一致
  eagle_eye INTEGER NOT NULL DEFAULT 3,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS players_best_score ON players (best_score DESC);

-- 玩家数值变动的幂等记录：同一次操作的网络重试按 request_id 去重，不重复加扣
-- resource 标明 delta 是哪个数值：points 是积分，eagleEye 是鹰眼次数
CREATE TABLE IF NOT EXISTS player_events (
  request_id TEXT PRIMARY KEY,
  openid TEXT NOT NULL,
  resource TEXT NOT NULL,
  delta REAL NOT NULL,
  created_at INTEGER NOT NULL
);
