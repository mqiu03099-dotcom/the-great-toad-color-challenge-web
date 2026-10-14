-- 线上已有库的增量脚本：新建两张汇总表和三个触发器，末尾把现有数据灌进汇总表
-- 原因：COUNT(*) 和「数比我分高的人」都会随玩家数线性增长，把 D1 每日读取额度吃满
-- 重复执行是安全的：末尾按 players 重算，不是累加

CREATE TABLE IF NOT EXISTS player_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  players INTEGER NOT NULL DEFAULT 0
);

-- 分数桶：bucket = best_score / 10，把「比我分高的人数」从扫全榜降成扫最多 99 行
CREATE TABLE IF NOT EXISTS score_buckets (
  bucket INTEGER PRIMARY KEY,
  cnt INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO player_stats (id, players) VALUES (1, 0);

-- 总人数由触发器维护，注册新玩家时 +1，不再每次 COUNT(*)
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

-- 分数只在刷新最高分时才变，真正变了才搬桶
CREATE TRIGGER IF NOT EXISTS score_buckets_update AFTER UPDATE OF best_score ON players
WHEN old.best_score <> new.best_score AND new.best_score > 0
BEGIN
  UPDATE score_buckets SET cnt = cnt - 1
   WHERE bucket = old.best_score / 10 AND old.best_score > 0;
  INSERT INTO score_buckets (bucket, cnt) VALUES (new.best_score / 10, 1)
  ON CONFLICT(bucket) DO UPDATE SET cnt = cnt + 1;
END;

-- 已有数据一次性灌入；先清空再重算，重复执行不会累加
UPDATE player_stats SET players = (SELECT COUNT(*) FROM players) WHERE id = 1;

DELETE FROM score_buckets;

INSERT INTO score_buckets (bucket, cnt)
SELECT best_score / 10, COUNT(*) FROM players WHERE best_score > 0 GROUP BY best_score / 10;
