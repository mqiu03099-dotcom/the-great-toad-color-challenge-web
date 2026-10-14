-- 线上已有库的增量脚本：只加字段和一张新表，不动已有数据
-- 先跑完这个脚本再发 worker；重复执行时 ALTER 会提示列已存在，可忽略
ALTER TABLE players ADD COLUMN points REAL NOT NULL DEFAULT 0;

-- 新注册送 3 次鹰眼；已注册用户也会读到 3，这是确认过的口径（线上原有的本地缓存次数不保留）
ALTER TABLE players ADD COLUMN eagle_eye INTEGER NOT NULL DEFAULT 3;

-- 玩家数值变动的幂等记录：同一次操作的网络重试按 request_id 去重，不重复加扣
CREATE TABLE IF NOT EXISTS player_events (
  request_id TEXT PRIMARY KEY,
  openid TEXT NOT NULL,
  resource TEXT NOT NULL,
  delta REAL NOT NULL,
  created_at INTEGER NOT NULL
);

-- 老用户一次性礼包：加列前就存在的玩家直接给 10 次（线上原来的本地缓存次数不迁移）
-- sentinel 行保证只发一次，脚本重跑不会把之后注册的新用户也刷成 10
UPDATE players SET eagle_eye = 10
WHERE NOT EXISTS (
  SELECT 1 FROM player_events WHERE request_id = 'legacy-eagle-eye-gift'
);

INSERT INTO player_events (request_id, openid, resource, delta, created_at)
VALUES ('legacy-eagle-eye-gift', 'migration', 'eagleEye', 10, unixepoch())
ON CONFLICT(request_id) DO NOTHING;
