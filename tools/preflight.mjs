// 上线前自检：只读，不写数据库、不部署、不改任何文件
// 用法：cd web && node tools/preflight.mjs        # 探测接口 + 核对本地配置
//       cd web && node tools/preflight.mjs --db   # 额外只读核对线上/测试库结构（约 40 秒）
import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "..");
const PROD = "https://milkyfrog.toolsbox.vip";
const STAGING = "https://milkyfrog-dev.toolsbox.vip";
const withDb = process.argv.includes("--db");
const todos = [];

const probe = async (base, apiPath) => {
  try {
    const res = await fetch(base + apiPath);
    return `${res.status} ${(await res.text()).slice(0, 60)}`;
  } catch (error) {
    return `请求失败：${error.message}`;
  }
};

const mark = (ok) => (ok ? "OK" : "NG");

console.log("== 本地迁移脚本（db/migrations/）");
for (const name of readdirSync(path.join(root, "db/migrations"))) {
  console.log(` - ${name}`);
}

console.log("\n== 本地环境配置");
const loginJs = readFileSync(path.join(repo, "constants/wechat-login.js"), "utf8");
const toml = readFileSync(path.join(root, "wrangler.toml"), "utf8");
const configChecks = [
  [`constants/wechat-login.js 的 trial 指向 ${STAGING}`, loginJs.includes(`"${STAGING}"`)],
  [`constants/wechat-login.js 的 release 指向 ${PROD}`, loginJs.includes(`"${PROD}"`)],
  ["web/wrangler.toml 仍有 [env.staging]", /\[env\.staging\]/.test(toml)],
];
for (const [label, ok] of configChecks) {
  console.log(` [${mark(ok)}] ${label}`);
}
if (configChecks.some(([, ok]) => !ok)) {
  todos.push("本地环境配置与 DEPLOY.md 不一致：检查 constants/wechat-login.js 与 web/wrangler.toml");
}

console.log("\n== 本地未提交改动（web 仓库）");
const dirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}).trim();
console.log(dirty ? dirty : " 无");
if (dirty) todos.push("web/ 有未提交改动，确认要上线的文件都提交了");

console.log("\n== 线上 Worker");
const prodPoints = await probe(PROD, "/api/points");
console.log(` /api/points -> ${prodPoints}`);
console.log(` /api/stats  -> ${await probe(PROD, "/api/stats")}`);
if (prodPoints.startsWith("404")) {
  todos.push(
    "线上还是旧代码：先跑 db/migrations/ 里的迁移，再执行 npx wrangler deploy（不带 --env）",
  );
}

console.log("\n== 测试环境");
const stagingPoints = await probe(STAGING, "/api/points");
console.log(` /api/points -> ${stagingPoints}`);
console.log(` /api/stats  -> ${await probe(STAGING, "/api/stats")}`);
if (stagingPoints.startsWith("404")) {
  todos.push("测试环境落后于本地代码：npx wrangler deploy --env staging");
}

if (withDb) {
  const readSchema = (dbName) => {
    const sql =
      "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='player_events') AS has_events," +
      " (SELECT COUNT(*) FROM pragma_table_info('players') WHERE name='points') AS has_points," +
      " (SELECT COUNT(*) FROM pragma_table_info('players') WHERE name='eagle_eye') AS has_eagle_eye";
    const out = execSync(
      `npx wrangler d1 execute ${dbName} --remote --json --command "${sql}"`,
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000 },
    );
    return JSON.parse(out.slice(out.indexOf("[")))[0].results[0];
  };

  for (const [label, dbName, blocking] of [
    ["线上库 milk-frog（只读核对）", "milk-frog", true],
    ["测试库 milk-frog-staging（只读核对）", "milk-frog-staging", false],
  ]) {
    console.log(`\n== ${label}`);
    try {
      const row = readSchema(dbName);
      console.log(` [${mark(row.has_points)}] players.points 列`);
      console.log(` [${mark(row.has_eagle_eye)}] players.eagle_eye 列`);
      console.log(` [${mark(row.has_events)}] player_events 表`);
      if (!row.has_points || !row.has_eagle_eye || !row.has_events) {
        todos.push(
          `${label} 缺少本次迁移的内容，先执行：npx wrangler d1 execute ${dbName} --remote --file=db/migrations/2026-10-13-player-points-eagle-eye.sql` +
            (blocking ? "（线上必须先迁移再 deploy）" : ""),
        );
      }
    } catch (error) {
      console.log(` 查不了：${String(error.message).split("\n")[0]}`);
      todos.push(`${label} 结构没查成功，确认 npx wrangler whoami 能过`);
    }
  }
} else {
  console.log("\n== 库结构未核对（加 --db 只读核对线上/测试库结构）");
}

console.log("\n== 待办");
console.log(todos.length ? todos.map((item) => ` - ${item}`).join("\n") : " 没有发现待办");
console.log("\n完整步骤见本仓库根目录 DEPLOY.md");
