-- 榜单排序专用索引：让「取前 N 名」直接顺着索引读，不再把整张榜捞出来排序
-- 列顺序必须和 worker/api.js 里的 RANK_ORDER 一致：best_score DESC, updated_at ASC, openid ASC
CREATE INDEX IF NOT EXISTS players_rank ON players (best_score DESC, updated_at ASC, openid ASC);
