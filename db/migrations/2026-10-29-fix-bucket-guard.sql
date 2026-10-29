-- 修正 2026-10-29 引入的桶计数缺陷：首次得分在 1-9 分时，old/new 都落到 bucket 0，
-- 被「同桶跳过」误判成不需要搬桶，导致这些玩家从未被计入 score_buckets。
-- 本脚本可重复执行（DROP/CREATE 触发器 + 末尾按 players 重算）。

DROP TRIGGER IF EXISTS score_buckets_update;
CREATE TRIGGER score_buckets_update AFTER UPDATE OF best_score ON players
WHEN old.best_score <> new.best_score AND new.best_score > 0
 AND (old.best_score = 0 OR old.best_score / 10 <> new.best_score / 10)
BEGIN
  UPDATE score_buckets SET cnt = cnt - 1
   WHERE bucket = old.best_score / 10 AND old.best_score > 0;
  INSERT INTO score_buckets (bucket, cnt) VALUES (new.best_score / 10, 1)
  ON CONFLICT(bucket) DO UPDATE SET cnt = cnt + 1;
END;

DELETE FROM score_buckets;
INSERT INTO score_buckets (bucket, cnt)
SELECT best_score / 10, COUNT(*) FROM players WHERE best_score > 0 GROUP BY best_score / 10;
