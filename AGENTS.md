# 约定（后端仓库 web/）

- 本仓库是 Cloudflare Worker + D1 后端，**发布相关先读同目录的 `DEPLOY.md`**，照它的清单执行，不要凭记忆。
- 上线前先跑只读自检：`node tools/preflight.mjs --db`（在 `web/` 下执行），按输出的「待办」逐条处理。
- 未获得明确许可不得运行这两条会改线上的命令：
  - `npx wrangler deploy`（不带 `--env` 时直接整体替换线上 Worker）
  - `npx wrangler d1 execute milk-frog --remote ...`（直接改线上库）
- `npx wrangler deploy --env staging` 只影响测试环境（`milkyfrog-dev.toolsbox.vip`）。
- 线上 Worker 的 Git 自动构建（Workers Builds）已在 2026-10-14 断开，`git push` 只把代码存进仓库、不触发发布；怀疑又被接上就先按 `DEPLOY.md` 第二节自查（它会静默改线上、且不跑迁移）。
- `wrangler.toml` 里 `assets.directory = "."`，`web/` 下所有文件默认都会发布到公网，新增文件先加进 `.assetsignore`。
