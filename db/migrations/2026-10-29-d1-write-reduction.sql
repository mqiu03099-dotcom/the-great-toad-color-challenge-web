-- 2026-10-29 降低 D1 每日写入：不改任何接口、返回结构和状态码，旧版/新版小程序无感
-- 执行顺序：先跑本迁移，再 `npx wrangler deploy`；反了会让 /api/points/earn 因缺列 500
-- 本脚本只能执行一次（ALTER TABLE ADD COLUMN 不可重复）；其余语句重复执行是安全的

-- 1) 积分入账的幂等标记从 player_events 挪到 players，省掉每局一次事件写入
ALTER TABLE players ADD COLUMN last_round_id TEXT;

-- 2) players_best_score 的 (best_score DESC) 是 players_rank 的前缀，已被完全覆盖
DROP INDEX IF EXISTS players_best_score;

-- 3) 最高分仍在同一个 10 分桶内时不必搬桶；桶内计数不变，名次结果完全一致
DROP TRIGGER IF EXISTS score_buckets_update;
CREATE TRIGGER score_buckets_update AFTER UPDATE OF best_score ON players
WHEN old.best_score <> new.best_score AND new.best_score > 0
 AND old.best_score / 10 <> new.best_score / 10
BEGIN
  UPDATE score_buckets SET cnt = cnt - 1
   WHERE bucket = old.best_score / 10 AND old.best_score > 0;
  INSERT INTO score_buckets (bucket, cnt) VALUES (new.best_score / 10, 1)
  ON CONFLICT(bucket) DO UPDATE SET cnt = cnt + 1;
END;
