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

CREATE INDEX IF NOT EXISTS players_rank ON players (best_score DESC, updated_at ASC, openid ASC);

-- 玩家数值变动的幂等记录：同一次操作的网络重试按 request_id 去重，不重复加扣
-- resource 标明 delta 是哪个数值：points 是积分，eagleEye 是鹰眼次数
CREATE TABLE IF NOT EXISTS player_events (
  request_id TEXT PRIMARY KEY,
  openid TEXT NOT NULL,
  resource TEXT NOT NULL,
  delta REAL NOT NULL,
  created_at INTEGER NOT NULL
);

-- 总人数汇总：只有 id = 1 一行，由 players 上的触发器维护
CREATE TABLE IF NOT EXISTS player_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  players INTEGER NOT NULL DEFAULT 0
);

-- 分数桶：bucket = best_score / 10，名次查询只需扫最多 99 行
CREATE TABLE IF NOT EXISTS score_buckets (
  bucket INTEGER PRIMARY KEY,
  cnt INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO player_stats (id, players) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS players_count_insert AFTER INSERT ON players
BEGIN
  UPDATE player_stats SET players = players + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS score_buckets_insert AFTER INSERT ON players
WHEN new.best_score > 0
BEGIN
  INSERT INTO score_buckets (bucket, cnt) VALUES (new.best_score / 10, 1)
  ON CONFLICT(bucket) DO UPDATE SET cnt = cnt + 1;
END;

CREATE TRIGGER IF NOT EXISTS score_buckets_update AFTER UPDATE OF best_score ON players
WHEN old.best_score <> new.best_score AND new.best_score > 0
BEGIN
  UPDATE score_buckets SET cnt = cnt - 1
   WHERE bucket = old.best_score / 10 AND old.best_score > 0;
  INSERT INTO score_buckets (bucket, cnt) VALUES (new.best_score / 10, 1)
  ON CONFLICT(bucket) DO UPDATE SET cnt = cnt + 1;
END;
