// 小程序接口：/api/login /api/score /api/nickname /api/leaderboard /api/user
// /api/points/earn /api/points/spend /api/eagle-eye/use /api/eagle-eye/reward
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_NICKNAME_LENGTH = 16;
// 榜单固定只出前 30 名，服务端写死，客户端不再传 limit
const LIST_LIMIT = 30;
// 榜单列表和个人名次必须共用同一套排序，否则同分时名次会和行号不一致
// shortcut: updated_at 只有秒精度，同秒同分只能按 openid 定序，要更细需提高 handleScore 的时间精度
const RANK_ORDER = "best_score DESC, updated_at ASC, openid ASC";
// 积分：一局得分每 10 分换 1 积分，10 积分兑换 1 次鹰眼
const EAGLE_EYE_ITEM = "eagleEye";
// 新注册就送 3 次，和建表默认值保持一致
const EAGLE_EYE_INITIAL_COUNT = 3;
const EAGLE_EYE_POINT_COST = 10;
const POINTS_PER_SCORE_DIVISOR = 10;
const MAX_REQUEST_ID_LENGTH = 64;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const toBase64Url = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (value) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const importKey = (secret) =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

async function createToken(openid, secret) {
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        openid,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importKey(secret),
    new TextEncoder().encode(payload),
  );

  return `${payload}.${toBase64Url(signature)}`;
}

// 缺失、过期、签名不对的 token 一律当未登录，返回空 openid
async function readToken(token, secret) {
  const [payload, signature] = String(token || "").split(".");

  if (!payload || !signature) {
    return "";
  }

  try {
    const isValid = await crypto.subtle.verify(
      "HMAC",
      await importKey(secret),
      fromBase64Url(signature),
      new TextEncoder().encode(payload),
    );

    if (!isValid) {
      return "";
    }

    const { openid, exp } = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload)),
    );

    return exp > Math.floor(Date.now() / 1000) ? openid : "";
  } catch (error) {
    return "";
  }
}

const readBearerToken = (request) => {
  const header = request.headers.get("authorization") || "";

  return header.startsWith("Bearer ") ? header.slice(7) : "";
};

async function readJsonBody(request) {
  try {
    const body = await request.json();

    return body && typeof body === "object" ? body : {};
  } catch (error) {
    return {};
  }
}

const readOpenid = (request, env) =>
  readToken(readBearerToken(request), env.TOKEN_SECRET);

async function handleLogin(request, env) {
  const { code } = await readJsonBody(request);

  if (!code) {
    return json({ error: "缺少 code" }, 400);
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", env.WECHAT_APP_ID);
  url.searchParams.set("secret", env.WECHAT_APP_SECRET);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  let session = {};

  try {
    session = await (await fetch(url)).json();
  } catch (error) {
    return json({ error: "微信登录服务不可用" }, 502);
  }

  if (!session.openid) {
    return json({ error: "登录失败" }, 401);
  }

  // 有就正常登录，没有就注册；不覆盖 updated_at，避免打乱同分排序
  await env.DB.prepare(
    "INSERT INTO players (openid, updated_at) VALUES (?, ?) ON CONFLICT(openid) DO NOTHING",
  )
    .bind(session.openid, Math.floor(Date.now() / 1000))
    .run();

  return json({ token: await createToken(session.openid, env.TOKEN_SECRET) });
}

async function handleScore(request, env) {
  const openid = await readOpenid(request, env);

  if (!openid) {
    return json({ error: "未登录" }, 401);
  }

  const { score } = await readJsonBody(request);

  if (!Number.isInteger(score) || score < 0) {
    return json({ error: "分数不合法" }, 400);
  }

  // updated_at 就是「达成当前最高分的时刻」，同分排序靠它，所以只有分数真的变高才刷新
  await env.DB.prepare(
    `INSERT INTO players (openid, best_score, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(openid) DO UPDATE SET
       best_score = MAX(players.best_score, excluded.best_score),
       updated_at = excluded.updated_at
     WHERE excluded.best_score > players.best_score`,
  )
    .bind(openid, score, Math.floor(Date.now() / 1000))
    .run();

  const row = await env.DB.prepare(
    "SELECT best_score FROM players WHERE openid = ?",
  )
    .bind(openid)
    .first();

  return json({ bestScore: row ? row.best_score : score });
}

async function handleNickname(request, env) {
  const openid = await readOpenid(request, env);

  if (!openid) {
    return json({ error: "未登录" }, 401);
  }

  const { nickname } = await readJsonBody(request);
  const trimmed = String(nickname || "").trim();
  const length = [...trimmed].length;

  if (length < 1 || length > MAX_NICKNAME_LENGTH) {
    return json({ error: `昵称需要 1-${MAX_NICKNAME_LENGTH} 个字符` }, 400);
  }

  // 改昵称不刷新 updated_at，否则改名会把自己从同分队列里挤走
  await env.DB.prepare(
    `INSERT INTO players (openid, nickname, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(openid) DO UPDATE SET nickname = excluded.nickname`,
  )
    .bind(openid, trimmed, Math.floor(Date.now() / 1000))
    .run();

  return json({ nickname: trimmed });
}

// 客户端给每次积分结算/兑换生成一个唯一 ID，网络重试带着同一个 ID 过来时只认第一次
const isRequestId = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_REQUEST_ID_LENGTH;

// 积分是分数除以 10，可能带一位小数；读出来顺手抹掉浮点尾巴
const normalizePoints = (value) =>
  Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;

// 积分和鹰眼次数都存服务端，返回给客户端的就是这份余额
// 昵称跟着这一行一起带回去，设置页就不用为了回显昵称再拉一次榜单
async function readWallet(env, openid) {
  const row = await env.DB.prepare(
    "SELECT points, eagle_eye, nickname FROM players WHERE openid = ?",
  )
    .bind(openid)
    .first();

  return {
    points: row ? normalizePoints(row.points) : 0,
    eagleEye:
      row && Number.isInteger(row.eagle_eye)
        ? row.eagle_eye
        : EAGLE_EYE_INITIAL_COUNT,
    nickname: row ? row.nickname || "" : "",
  };
}

async function recordPlayerEvent(env, requestId, openid, resource, delta) {
  const result = await env.DB.prepare(
    `INSERT INTO player_events (request_id, openid, resource, delta, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`,
  )
    .bind(requestId, openid, resource, delta, Math.floor(Date.now() / 1000))
    .run();

  return Boolean(result.meta && result.meta.changes);
}

// 扣不动（余额不够）时撤掉这次幂等记录，玩家条件够了再用同一个 requestId 重试
async function removePlayerEvent(env, requestId) {
  await env.DB.prepare("DELETE FROM player_events WHERE request_id = ?")
    .bind(requestId)
    .run();
}

// 玩家资料：players 里除 openid 外的字段 + 总人数，一次请求拿全
// bestScoreAt 就是 updated_at，表示达成当前最高分的时刻（同分排序用）
async function handleUser(request, env) {
  const openid = await readOpenid(request, env);

  if (!openid) {
    return json({ error: "未登录" }, 401);
  }

  const row = await env.DB.prepare(
    `SELECT nickname, best_score, points, eagle_eye, updated_at,
            (SELECT players FROM player_stats WHERE id = 1) AS players
       FROM players WHERE openid = ?`,
  )
    .bind(openid)
    .first();

  return json({
    bestScore: row ? row.best_score : 0,
    bestScoreAt: row ? row.updated_at : 0,
    eagleEye:
      row && Number.isInteger(row.eagle_eye)
        ? row.eagle_eye
        : EAGLE_EYE_INITIAL_COUNT,
    nickname: row ? row.nickname || "" : "",
    players: row && Number.isInteger(row.players) ? row.players : 0,
    points: row ? normalizePoints(row.points) : 0,
  });
}

// 一局结束结算积分，同一个 roundId 只会入账一次
async function handlePointsEarn(request, env) {
  const openid = await readOpenid(request, env);

  if (!openid) {
    return json({ error: "未登录" }, 401);
  }

  const { roundId, score } = await readJsonBody(request);

  if (!isRequestId(roundId)) {
    return json({ error: "缺少对局标识" }, 400);
  }

  if (!Number.isInteger(score) || score < 0) {
    return json({ error: "分数不合法" }, 400);
  }

  const gained = score / POINTS_PER_SCORE_DIVISOR;

  // 不动 updated_at，它代表最高分达成时刻，改了会打乱同分排名
  // 幂等改存 players.last_round_id：同一局重试时 WHERE 不成立，只花一次写入
  await env.DB.prepare(
    `INSERT INTO players (openid, points, last_round_id, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(openid) DO UPDATE SET
       points = ROUND(players.points + excluded.points, 1),
       last_round_id = excluded.last_round_id
     WHERE players.last_round_id IS NULL OR players.last_round_id <> excluded.last_round_id`,
  )
    .bind(openid, gained, roundId, Math.floor(Date.now() / 1000))
    .run();

  return json({ ...(await readWallet(env, openid)), gained });
}

// 兑换道具：扣积分和幂等记录绑定，扣不动就撤掉记录，玩家攒够积分后重试才能真的兑换
async function handlePointsSpend(request, env) {
  const openid = await readOpenid(request, env);

  if (!openid) {
    return json({ error: "未登录" }, 401);
  }

  const { item, requestId } = await readJsonBody(request);

  if (!isRequestId(requestId)) {
    return json({ error: "缺少兑换标识" }, 400);
  }

  if (item !== EAGLE_EYE_ITEM) {
    return json({ error: "道具不存在" }, 400);
  }

  if (
    !(await recordPlayerEvent(
      env,
      `spend:${requestId}`,
      openid,
      "points",
      -EAGLE_EYE_POINT_COST,
    ))
  ) {
    return json({ ...(await readWallet(env, openid)), granted: 1 });
  }

  // 扣积分和加次数放在同一条 UPDATE 里，不会出现扣了积分没加次数
  const result = await env.DB.prepare(
    `UPDATE players SET points = ROUND(points - ?, 1), eagle_eye = eagle_eye + 1
     WHERE openid = ? AND points >= ?`,
  )
    .bind(EAGLE_EYE_POINT_COST, openid, EAGLE_EYE_POINT_COST)
    .run();

  if (!result.meta || !result.meta.changes) {
    await removePlayerEvent(env, `spend:${requestId}`);

    return json({ error: "积分不足" }, 409);
  }

  return json({ ...(await readWallet(env, openid)), granted: 1 });
}

// 用一次鹰眼：先扣服务端次数，扣成功客户端才揭示答案
async function handleEagleEyeUse(request, env) {
  const openid = await readOpenid(request, env);

  if (!openid) {
    return json({ error: "未登录" }, 401);
  }

  const { requestId } = await readJsonBody(request);

  if (!isRequestId(requestId)) {
    return json({ error: "缺少使用标识" }, 400);
  }

  if (
    !(await recordPlayerEvent(env, `use:${requestId}`, openid, "eagleEye", -1))
  ) {
    return json(await readWallet(env, openid));
  }

  const result = await env.DB.prepare(
    "UPDATE players SET eagle_eye = eagle_eye - 1 WHERE openid = ? AND eagle_eye > 0",
  )
    .bind(openid)
    .run();

  if (!result.meta || !result.meta.changes) {
    await removePlayerEvent(env, `use:${requestId}`);

    return json({ error: "鹰眼不够" }, 409);
  }

  return json(await readWallet(env, openid));
}

// 看完激励广告送一次鹰眼：广告没有服务端回调，客户端上报的 requestId 只能防重复入账
async function handleEagleEyeReward(request, env) {
  const openid = await readOpenid(request, env);

  if (!openid) {
    return json({ error: "未登录" }, 401);
  }

  const { requestId } = await readJsonBody(request);

  if (!isRequestId(requestId)) {
    return json({ error: "缺少奖励标识" }, 400);
  }

  if (
    !(await recordPlayerEvent(
      env,
      `reward:${requestId}`,
      openid,
      "eagleEye",
      1,
    ))
  ) {
    return json(await readWallet(env, openid));
  }

  await env.DB.prepare(
    "UPDATE players SET eagle_eye = eagle_eye + 1 WHERE openid = ?",
  )
    .bind(openid)
    .run();

  return json(await readWallet(env, openid));
}

async function readMyRank(request, env) {
  const openid = await readOpenid(request, env);

  if (!openid) {
    return null;
  }

  // 自己的那一行走主键查，只读 1 行
  const me = await env.DB.prepare(
    "SELECT nickname, best_score, updated_at FROM players WHERE openid = ?",
  )
    .bind(openid)
    .first();

  if (!me) {
    return null;
  }

  // 还没上过榜也要把昵称带回去，客户端据此判断“设置过昵称没有”
  if (me.best_score <= 0) {
    return { rank: null, score: 0, nickname: me.nickname || "" };
  }

  // 名次 = 排在自己前面的人数 + 1，口径必须和 RANK_ORDER 一致：
  // 分数高的在前；同分 updated_at 早的在前；再相同按 openid
  // 分数比我高的那一段由 score_buckets 求和给出（最多 99 行），只剩本桶内比我先的少数几行要精确数
  const bucket = Math.floor(me.best_score / 10);
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(cnt), 0) FROM score_buckets WHERE bucket > ?) AS higher_buckets,
       (SELECT COUNT(*) FROM players
         WHERE best_score > ? AND best_score < ?) AS same_bucket,
       (SELECT COUNT(*) FROM players
         WHERE best_score = ? AND (updated_at < ? OR (updated_at = ? AND openid < ?))) AS tie_ahead`,
  )
    .bind(
      bucket,
      me.best_score,
      (bucket + 1) * 10,
      me.best_score,
      me.updated_at,
      me.updated_at,
      openid,
    )
    .first();

  return {
    rank: row.higher_buckets + row.same_bucket + row.tie_ahead + 1,
    score: me.best_score,
    nickname: me.nickname || "",
  };
}

async function handleLeaderboard(request, env) {
  const { results } = await env.DB.prepare(
    `SELECT nickname, best_score FROM players WHERE best_score > 0
     ORDER BY ${RANK_ORDER} LIMIT ?`,
  )
    .bind(LIST_LIMIT)
    .all();

  const list = results.map((row, index) => ({
    rank: index + 1,
    nickname: row.nickname || "匿名奶蛙",
    score: row.best_score,
  }));

  return json({ list, me: await readMyRank(request, env) });
}

const ROUTES = {
  "POST login": handleLogin,
  "POST score": handleScore,
  "POST nickname": handleNickname,
  "GET leaderboard": handleLeaderboard,
  "GET user": handleUser,
  "POST points/earn": handlePointsEarn,
  "POST points/spend": handlePointsSpend,
  "POST eagle-eye/use": handleEagleEyeUse,
  "POST eagle-eye/reward": handleEagleEyeReward,
};

export async function handleApi(request, env) {
  // 路径统一从 URL 解析，Pages Functions 与 Worker 共用同一份逻辑
  const path = new URL(request.url).pathname
    .replace(/^\/api\/?/, "")
    .replace(/\/+$/, "");
  const handler = ROUTES[`${request.method} ${path}`];

  if (!handler) {
    return json({ error: "接口不存在" }, 404);
  }

  return handler(request, env);
}
