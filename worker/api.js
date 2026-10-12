// 小程序排行榜接口：/api/login /api/score /api/nickname /api/leaderboard
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_NICKNAME_LENGTH = 16;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
// 榜单列表和个人名次必须共用同一套排序，否则同分时名次会和行号不一致
// shortcut: updated_at 只有秒精度，同秒同分只能按 openid 定序，要更细需提高 handleScore 的时间精度
const RANK_ORDER = "best_score DESC, updated_at ASC, openid ASC";
// shortcut: 999 只挡明显离谱的分数，客户端上报本身就可伪造；要真防作弊得让服务端出题发 token
const MAX_SCORE = 999;

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

  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
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

async function readMyRank(request, env) {
  const openid = await readOpenid(request, env);

  if (!openid) {
    return null;
  }

  const row = await env.DB.prepare(
    `SELECT rank, best_score, nickname FROM (
       SELECT openid, nickname, best_score, ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER}) AS rank
       FROM players WHERE best_score > 0
     ) WHERE openid = ?`,
  )
    .bind(openid)
    .first();

  // 客户端本地缓存丢了也能拿回服务端存过的昵称，设置页据此回显
  return row
    ? { rank: row.rank, score: row.best_score, nickname: row.nickname || "" }
    : null;
}

async function handleLeaderboard(request, env) {
  const requested = Number.parseInt(
    new URL(request.url).searchParams.get("limit"),
    10,
  );
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIST_LIMIT)
    : DEFAULT_LIST_LIMIT;

  const { results } = await env.DB.prepare(
    `SELECT nickname, best_score FROM players WHERE best_score > 0
     ORDER BY ${RANK_ORDER} LIMIT ?`,
  )
    .bind(limit)
    .all();

  const list = results.map((row, index) => ({
    rank: index + 1,
    nickname: row.nickname || "匿名奶蛙",
    score: row.best_score,
  }));

  return json({ list, me: await readMyRank(request, env) });
}

// 首页页脚的用户总数，公开接口，注册过就算一个人
async function handleStats(request, env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS players FROM players",
  ).first();

  return json({ players: row ? row.players : 0 });
}

const ROUTES = {
  "POST login": handleLogin,
  "POST score": handleScore,
  "POST nickname": handleNickname,
  "GET leaderboard": handleLeaderboard,
  "GET stats": handleStats,
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