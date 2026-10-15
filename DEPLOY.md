# 上线手册（后端仓库 web/）

> 记录「奶蛙颜色大挑战」的三套环境、上线步骤和当前上线状态。改环境或改发布流程时请同步更新这里。
> 本文件放在后端仓库 `web/` 里：发布动作都在这个仓库执行，手册跟着代码走，clone 后端就带得上。
> **本文件和 `web/AGENTS.md` 都要提交进 Git**，否则换机器或清理工作区时会跟着丢。
> 最后更新：2026-10-14

## 一、三套环境

| 环境 | 小程序 envVersion | API 域名 | Cloudflare Worker | D1 库 |
| --- | --- | --- | --- | --- |
| 本地 | develop | http://127.0.0.1:8788 | `wrangler dev`（web/ 目录） | `web/.wrangler/state`（本地文件） |
| 测试 | trial | https://milkyfrog-dev.toolsbox.vip | the-great-toad-color-challenge-web-staging | milk-frog-staging |
| 线上 | release | https://milkyfrog.toolsbox.vip | the-great-toad-color-challenge-web | milk-frog |

域名映射写在 `constants/wechat-login.js` 的 `API_BASE_URL_BY_ENV_VERSION`，改完**必须重新上传体验版 / 重新发版**才生效。

## 二、哪些动作会动线上

| 动作 | 线上 Worker | 线上 D1 | 正式版小程序 |
| --- | --- | --- | --- |
| `git commit` / `git push` | 不变 | 不变 | 不变 |
| `npx wrangler deploy`（不带 `--env`） | **立即整体替换** | 不变 | 下次请求即新代码 |
| `npx wrangler d1 execute milk-frog --remote ...` | 不变 | **会被改** | 间接生效 |
| `npx wrangler deploy --env staging` | 不变 | 不变 | 不变 |
| 小程序「上传体验版」 | 不变 | 不变 | 不变 |
| 小程序「发布」 | 不变 | 不变 | **会更新版本** |

`push` 不影响线上，但这条有前情：线上 Worker **曾经挂着 Cloudflare Git 自动构建**（Workers Builds，GitHub 仓库 `mqiu03099-dotcom/the-great-toad-color-challenge-web` 的 `main` 分支）——从 2026-10-12 起每次 push 都会自动构建并发布到线上，而且**不会**跑数据库迁移；2026-10-13 起线上那几次「没人手动执行过的部署」和本次「线上新代码 + 旧库结构」都是它干的。

- 该 Git 连接已于 **2026-10-14 14:31** 在后台「设置 → 构建 → 断开连接」断掉，之后线上只能在本机 `npx wrangler deploy` 手发。
- 测试环境 Worker（`...-web-staging`）从来没接过 Git 自动构建，一直只有本机 `npx wrangler deploy --env staging`。
- 自动构建发出来的部署，元数据仍写 `source: wrangler`、`last_deployed_from: wrangler`，**光看 `wrangler deployments list` 分辨不出来**。要区分只有两条路：
  - GitHub 上该 commit 的 check-runs 里有没有 `Workers Builds: the-great-toad-color-challenge-web`：`curl.exe -s https://api.github.com/repos/mqiu03099-dotcom/the-great-toad-color-challenge-web/commits/<sha>/check-runs`
  - 后台「Workers & Pages → 该 Worker → 设置 → 构建」：正常是「Git 存储库 → 连接」；如果那里又列出了仓库名，说明自动构建被重新接上了（**push 会直接改线上**，先断开再 push）

## 三、后端上线（顺序不能反）

```powershell
cd D:\giteeContent\the-great-toad-color-challenge\web

# 1. 库结构变更（没有新迁移就跳过；跑之前先看清文件名）
npx wrangler d1 execute milk-frog --remote --file=db/migrations/<迁移文件>.sql

# 2. 再发 Worker
npx wrangler deploy
```

- `wrangler` 不在 PATH 上，统一用 `npx wrangler`
- 先迁移后 deploy；反过来的话新接口会 500，老接口不受影响
- 验证：

```powershell
curl.exe -s https://milkyfrog.toolsbox.vip/api/user
curl.exe -s "https://milkyfrog.toolsbox.vip/api/leaderboard?limit=2"
```

`/api/user` 返回 `{"error":"未登录"}`（401）说明新代码已生效；返回 `{"error":"接口不存在"}`（404）说明线上还是旧代码。

## 四、测试环境（体验版用）

```powershell
cd D:\giteeContent\the-great-toad-color-challenge\web

# 空库初始化用 db/schema.sql；已有库的增量用 db/migrations/ 里的脚本
npx wrangler d1 execute milk-frog-staging --remote --file=db/schema.sql
npx wrangler deploy --env staging
```

- secrets 已设置：`TOKEN_SECRET`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`；要改就 `npx wrangler secret put <名字> --env staging`
- staging 的 `TOKEN_SECRET` 和线上不同：跨环境的旧 token 会被服务端拒绝，客户端 401 会自动清 token 重登一次，不用手动清缓存
- `milkyfrog-dev.toolsbox.vip` 是 Worker 的 custom domain，DNS 由 Cloudflare 自动维护

## 五、小程序发布

1. 微信开发者工具点「上传」
2. 微信公众平台 → 版本管理 → 提交审核
3. 审核通过后点「发布」；在这一步之前，正式版用户拿到的还是旧版本

体验版和正式版跑的是同一个包，区别只在 `envVersion`（trial / release）。

## 六、微信后台配置

- 开发管理 → 开发设置 → 服务器域名 → request 合法域名：已加 `https://milkyfrog.toolsbox.vip`、`https://milkyfrog-dev.toolsbox.vip`
- 这个配置**每个自然月只有 5 次修改机会**

## 七、上线状态（2026-10-14 晚记录）

已完成：

- 测试环境：新 Worker + 空库 `milk-frog-staging`，`https://milkyfrog-dev.toolsbox.vip/api/points` 返回 401，说明新代码在跑
- 线上 Worker 已回滚到 `b6034800`（2026-10-14 14:54，即误发布前的版本），线上回到「旧代码 + 旧库结构」的一致状态：`/api/points` 返回 404

还没上线（明天要一次性补上）：

- 线上库还没跑 `db/migrations/2026-10-13-player-points-eagle-eye.sql`（加 `points`、`eagle_eye` 两列 + 建 `player_events` 表；里面有一次性给老用户补 10 次鹰眼的逻辑，靠 `legacy-eagle-eye-gift` sentinel 保证只发一次）
- 线上库还没跑 `db/migrations/2026-10-14-players-rank-index.sql`（榜单排序索引 `players_rank`，名次查询靠它才能覆盖 `updated_at`）
- 线上库还没跑 `db/migrations/2026-10-14-player-stats-buckets.sql`（`player_stats`、`score_buckets` 两张汇总表 + 3 个触发器 + 回填）
- 待上线的 Worker 里带了读取量优化（`/api/stats` 改读汇总表、名次查询改走分数桶）：**没有先跑 `2026-10-14-player-stats-buckets.sql` 就 deploy，`/api/stats` 和带登录态的 `/api/leaderboard` 会 500**
- 小程序「积分 / 鹰眼 / 个人信息卡片」这一批还没提交审核

上线顺序：**先跑三条迁移 → 再 `npx wrangler deploy` → 再提交审核 → 最后发布**

## 八、回滚

- Worker：要回到**指定的某个历史版本**用 `npx wrangler versions deploy <版本ID>@100% --yes`（2026-10-14 14:54 线上实测）。版本 ID 从 `npx wrangler deployments list --name the-great-toad-color-challenge-web` 里取；`npx wrangler rollback` 只退到上一个部署，误发了好几版时退不到你想去的那一版
- 库结构：目前所有迁移都是「只加不减」（`ALTER TABLE ADD COLUMN` + `CREATE TABLE IF NOT EXISTS`），没有反向脚本；D1 的面板里有按时间点恢复（**未实测**）

## 九、上线前自检（只读）

```powershell
cd D:\giteeContent\the-great-toad-color-challenge\web
node tools/preflight.mjs        # 探测接口 + 核对本地配置
node tools/preflight.mjs --db   # 额外只读核对线上/测试库结构（约 40 秒）
```

输出：本地迁移脚本清单、本地环境配置核对、web/ 未提交改动、线上与测试环境的接口探测结果、待办清单。
它只读——不写库、不部署、不改文件，随时可以跑。脚本在 `tools/preflight.mjs`，和本文件一样列在 `.assetsignore` 里，不会被当成网站静态资源发布。

注意：`wrangler.toml` 里 `assets.directory = "."`，**`web/` 目录下所有文件默认都会发布到线上**，新增任何文件（脚本、手册、笔记）都要先加进 `.assetsignore`，否则任何人都能通过网址读到。

## 十、上线执行清单（照抄执行，做完一步勾一步）

上线那天按这个顺序走，每一步都有可核对的输出；跑完把输出回填到第十一节。

- [ ] 1. 确认工作区：仓库根目录和 `web/` 各跑一次 `git status --short`，确认要上线的改动都已提交
- [ ] 2. 自检：`cd web; node tools/preflight.mjs --db`，先看「待办」一节
- [ ] 3. 线上库迁移（**三条都要，顺序不能反**）：`npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-13-player-points-eagle-eye.sql`，再 `npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-14-players-rank-index.sql`，最后 `npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-14-player-stats-buckets.sql`
- [ ] 4. 核对线上库结构：再跑 `node tools/preflight.mjs --db`，线上六个标记（`points` / `eagle_eye` / `player_events` / `players_rank` / `player_stats` / `score_buckets`）必须都是 `OK`
- [ ] 5. 发 Worker：`npx wrangler deploy`（**不带 `--env`**；带 `--env staging` 发的是测试环境，别搞反）
- [ ] 6. 验证接口：`curl.exe -s https://milkyfrog.toolsbox.vip/api/user` 应返回 401 `{"error":"未登录"}`；返回 404 说明还是旧代码
- [ ] 7. 线上真机过一遍：积分累计、鹰眼兑换、个人信息卡片、结果页最佳纪录
- [ ] 8. 小程序：上传 → 提交审核 → 审核通过后发布
- [ ] 9. 回填第十一节的记录

顺序不能反：第 3 步没做就做第 5 步，新接口会 500；反过来先 deploy 后迁移，只有新接口不可用，补跑迁移即可恢复，老功能不受影响。

重复执行：`2026-10-14` 的两条都是 `IF NOT EXISTS` + 末尾按 `players` 重算，可以放心重跑；手动删过 `players` 里的行之后，也用 `2026-10-14-player-stats-buckets.sql` 把汇总表修回真实值（目前没有 `DELETE` 触发器，删行不会自动减）。`2026-10-13` 那条不是可重复执行的（列已存在时 `ALTER` 会报错，脚本会不会继续往下跑未实测），跑之前先看第 2 步的 `players.points` 标记，已经是 `OK` 就别再跑。

## 十一、上线记录（每次上线追加一行，不要删旧行）

时间以本机时钟为准；记不准的写「约」，不要凭印象编精确时间。

| 日期时间 | 环境 | 动作 | 命令 | 结果证据 |
| --- | --- | --- | --- | --- |
| 2026-10-14 11:49 | 测试 | 建库 + 迁移 + 部署 | `npx wrangler d1 execute milk-frog-staging --remote --file=db/schema.sql`，然后 `npx wrangler deploy --env staging` | `GET https://milkyfrog-dev.toolsbox.vip/api/points` → 401 `{"error":"未登录"}`（时间取自 Cloudflare 记录 2026-10-14T03:49:05Z） |
| 2026-10-14 约 12:20 | 线上 | 只读核对，未改动任何东西 | `npx wrangler d1 execute milk-frog --remote --json --command "SELECT ..."` | 库里只有 `players` 表（没有 `player_events`），响应 `rows_written: 0`；`GET /api/points` → 404，当时线上还是旧代码（13:53 之后已变） |
| 2026-10-14 约 13:05 | 测试 | 只读核对 `.assetsignore` 是否真的挡住内部文件 | `curl.exe -s -o NUL -w "%{http_code}" https://milkyfrog-dev.toolsbox.vip/<路径>` | `/` → 200；`/wrangler.toml`、`/tools/preflight.mjs`、`/db/schema.sql` → 全部 404，证明列进 `.assetsignore` 的文件不会被发布；本手册和 `AGENTS.md` 已加进去 |
| 2026-10-14 约 13:45 | 代码 | 提交并推送两个仓库 | 主仓库 `git push origin master`；`web/` 里 `git push origin main` | 主仓库 `97d52e3..ddb4c8c`；web 仓库 `2de6804..bbd086b`；两端远端 SHA 与本地 HEAD 一致 |
| 2026-10-14 13:53 | 测试 | 部署 staging（本轮执行） | `npx wrangler deploy --env staging` | version `ed27e895-2f31-4036-a271-f31efd56a363`；`/` 200、`/api/points` 401、`/DEPLOY.md` 与 `/AGENTS.md` 404 |
| 2026-10-14 13:53 | 线上 | ⚠️ **不是本轮执行的动作**：线上 Worker 出现新部署，来源待确认 | `npx wrangler deployments list --name the-great-toad-color-challenge-web --json` → `"source": "wrangler"` | version `d53971fc-ee52-4c75-bb44-92df472b61ba`（05:53:42Z，比本轮 staging 部署晚 0.8 秒）。线上因此变成新代码；同一时刻线上库仍是旧结构，`SELECT points, eagle_eye FROM players` 报 `no such column: points` |
| 2026-10-14 14:31 | 构建配置 | 断开线上 Worker 的 Git 自动构建（只改构建配置：未触发部署、未动库、未改代码） | 后台 `Workers & Pages → the-great-toad-color-challenge-web → 设置 → 构建 → 断开连接` | 确认弹窗原文「断开连接后，将来的推送不会再触发自动部署」；断开后该区块只剩「Git 存储库 → 连接」。断开前后线上 `script_tag=39dff1a0baa3448aa519d7da2b7f8647`、`modified_on=2026-10-14T05:58:38Z`、最新部署 `f957f461`（05:58:37Z）均未变；`/api/stats` 200、`/api/leaderboard?limit=1` 200、`/api/points` 401 |
| 2026-10-14 14:37 | 验证 | 推一个纯文档 commit，实测 push 是否还会触发自动构建（本轮执行） | 主仓库 `git push origin master`（`ddb4c8c..884ce86`，Gitee 侧本来就没有自动构建）；`web/` 里 `git push origin main`（`78c6517..438bdcb`） | `438bdcb` 的 check-runs 只剩 GitHub Pages 的 `build` / `report-build-status` / `deploy`，**没有** `Workers Builds`（对比：断开前的 `78c6517` / `bbd086b` / `2de6804` 都有）；线上 Worker `script_tag=39dff1a0baa3448aa519d7da2b7f8647`、`modified_on=2026-10-14T05:58:38Z`、最新部署 `f957f461`（05:58:37Z）全部没变；测试环境最新部署仍是 `4b8186e4`（05:53:41Z，本机手发）、`modified_on=2026-10-14T05:53:43Z` 没变；线上 `/api/stats` 200、`/api/points` 401，`/DEPLOY.md` 与 `/AGENTS.md` 仍 404 |

| 2026-10-14 14:45 | 线上 | 只读核查误发布影响（未改动线上任何东西） | 接口探测 + `npx wrangler d1 execute milk-frog --remote --json --command "..."` + Cloudflare GraphQL | `GET /api/points` 带登录态 → 500 空 body（`readWallet` 读了不存在的列）；`/api/stats` 200、`/api/leaderboard?limit=3` 200 且带登录态 `me` 正常；`players` 表只有 4 列（openid/nickname/best_score/updated_at，没有 points/eagle_eye）；当天该 Worker 调用 success 2212、scriptThrewException 仅 2（均为人工探测）；全库 2941 人里 1188 人 `best_score <= 0`，这些人在正式版排行榜会多显示一块「我的名次：第 名 / 最高分 0」 |
| 2026-10-14 14:54 | 线上 | 回滚 Worker 到误发布前的版本（本轮执行） | `npx wrangler versions deploy b6034800-304e-475d-a99b-8095e2bc6b88@100% --yes` | 回滚前 `aeb8d6b1`（05:58:37Z）；回滚后当前部署 `b6034800`（100%，版本创建于 2026-10-13T08:25:18Z，对应 commit `2de6804`）。验证：`GET /api/points` 带/不带登录态均 404、`/api/points/earn` 404、`/api/eagle-eye/state` 404、`/api/stats` 200、`/api/leaderboard?limit=3` 200 且未登录时 `me: null` |

| 2026-10-15 约 11:30 | 线上 | 优化 D1 读取：建排序索引 + 汇总表（player_stats / score_buckets + 触发器）+ 部署新版 Worker（本轮执行） | `npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-14-players-rank-index.sql`；`npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-14-player-stats-buckets.sql`；`npx wrangler deploy`（不带 --env） | 索引：8333 行读 / 4125 行写；汇总表：8904 行读 / 70 行写（此后 3 张表）；一致性 players=4125 / stats_players=4125 / bucket_sum=2357 / diff=0；部署 version `35550fb2-6554-43d8-b572-eb64eca72834`；`/api/stats` 200 `{"players":4131}`、`/api/leaderboard` 200（前 20）；真实新用户登录注册成功（stats 4125→4127，触发器联动）；score/nickname 写路径用临时 openid 冒烟通过并已清理（probes=0）；`/api/user` 等新接口当前报 `no such column: points`，属计划内，等新版小程序发布时再跑 2026-10-13 迁移 |
| 2026-10-15 约 12:10 | 测试 | 按最新代码部署 staging（本轮执行） | `npx wrangler deploy --env staging` | version `b78a79fa-f69f-45fd-b4b9-63221440cbd8`；`GET /api/stats` → 200 `{"players":4}`、`/api/leaderboard` 200、`/api/user` 与 `/api/points` 无 token 均 401 `{"error":"未登录"}`；测试库 4 张表齐全（players 含 points/eagle_eye、player_events、player_stats、score_buckets） |
| 2026-10-15 下午 | 线上 | 补最后一条迁移：`players` 加 `points` / `eagle_eye` 两列 + 建 `player_events` 表 + 老用户一次性礼包（本轮执行） | `npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-13-player-points-eagle-eye.sql` | 5 条语句 / 13468 行读 / 4488 行写 / 10.17ms / 库表数 3→4；迁移前基线 4481 人 → 礼包发出 4481 份（`eagle_eye=10` 共 4481 人），迁移后新注册 1 人拿默认 3，`legacy-eagle-eye-gift` sentinel 恰好 1 行，`SUM(eagle_eye)=44813=4481*10+3*1`；一致性 `player_stats`=4482=`COUNT(*)`、`score_buckets` 合计 2564 = 上榜人数；`handleUser`（`nickname,best_score,points,eagle_eye,updated_at`）与 `readWallet`（`points,eagle_eye,nickname`）两条 SQL 线上均可执行；接口 `/api/stats` 200 `{"players":4483}`、`/api/leaderboard?limit=2` 200 `me:null`、`/api/points`、`/api/user`、`points/earn`、`points/spend`、`eagle-eye/use`、`eagle-eye/reward` 无 token 均 401；当日 Worker 调用 2322 次（success 2321 + clientDisconnected 1、scriptThrewException 0），其中 2026-10-15 11:24 部署点之后 1285 次全 success。**未执行 `npx wrangler deploy`**：线上 Worker 已是同一份代码（commit `a4c6138`，版本 `35550fb2`），重复部署无行为差异 |
| 2026-10-15 下午 | 测试 + 线上 | 删除新版本小程序不再调用的 `GET /api/stats` / `GET /api/points`（三个文件：`worker/api.js`、`tools/preflight.mjs`、本文件），重新部署两个环境（本轮执行） | `git push origin main`（`a5dde4b..fa107f9`）；`npx wrangler deploy --env staging`；`npx wrangler deploy`（不带 `--env`） | 上线前 `node tools/preflight.mjs --db`：线上库与测试库六个标记（`points` / `eagle_eye` / `player_events` / `players_rank` / `player_stats` / `score_buckets`）全 `OK`；路由冒烟（`local/verify-routes-20261015.mjs`，直接 import `handleApi`，不连库）：9 条路由行为符合预期，其中 `GET /api/stats`、`GET /api/points` 均 404 `{"error":"接口不存在"}`；测试 version `76add14c-e1bc-4280-ac5c-493a37661761`、线上 version `f477bfad-0ecc-4e0a-9bb5-fbaf010bc864`（回退点 `35550fb2-6554-43d8-b572-eb64eca72834`）；线上 11 项探测全对：`/api/user`、`POST /api/score`、`POST /api/nickname`、`points/earn`、`points/spend`、`eagle-eye/use`、`eagle-eye/reward` 无 token 均 401，`GET /api/stats` 与 `GET /api/points` 404，`/api/leaderboard?limit=2` 200（`鸡蛋仔` 936 分），`/` 200、`/json/page-ads.json` 200、`/DEPLOY.md` 404；自 00:00Z 起 Worker 调用 2659 次（success 2658 + clientDisconnected 1，`scriptThrewException` 0），03:24Z（11:24 那次部署）之后 1621 次全 0 错误；线上真实流量（近 1 小时）：`/api/user` 144 次 200（新包）、`/api/stats` 82 次 200 全部在 15:38 之前、之后只剩本轮自己的 1 次 404，说明老包基本退场 |
## 十二、隔久了怎么恢复上下文

三步，两分钟：

1. 读本文件，重点看第一、二、三、七、十、十三节
2. `cd web; node tools/preflight.mjs --db`——「待办」会直接告诉你线上还差哪一步
3. 需要本机级细节（wrangler 登录位置、本机踩过的坑）看记忆笔记：
   `C:\Users\blbq2\.codex\memories\extensions\ad_hoc\notes\20261014-121613-the-great-toad-envs-and-deploy.md`

**什么时候必须回来改这个文件**：改域名 / 建新库 / 加新迁移脚本 / 改上线顺序 / 每次上线跑完（追加第十一节）。

**最容易丢的几件事**：

- 迁移脚本忘了跑，新接口 500
- `deploy` 的 `--env` 带错方向，把测试发成了线上（或反过来把线上发成测试）
- 改了 `constants/wechat-login.js` 的域名映射，但没重新上传体验版，测试环境不生效
- 微信后台的 request 合法域名没加新域名（每月只有 5 次修改机会，先想清楚再改）

## 十三、接口清单与 `/api/user` 字段契约

`worker/api.js` 里的 `ROUTES` 就是全部路由，`方法 + 路径` 必须完全匹配，否则 404 `{"error":"接口不存在"}`。
鉴权=「需要」表示请求头必须带 `authorization: Bearer <token>`，缺失或过期返回 401 `{"error":"未登录"}`（客户端拿到 401 会清 token 重登一次再重试）。

| 方法 路径 | 用途 | 鉴权 | 读行数 | 写库 |
| --- | --- | --- | --- | --- |
| `POST /api/login` | `code` 换 token（有效期 7 天） | 不需要 | — | 新用户注册要写 |
| `POST /api/score` | 上报本局分数、刷新最高分 | 需要 | — | 写 |
| `POST /api/nickname` | 保存昵称 | 需要 | — | 写 |
| `GET /api/leaderboard` | 榜单前 20 名 + 自己的名次 | 可选 | 20 + 5 | 不写 |
| `GET /api/user` | **`players` 表全字段 + 总人数**，读玩家资料只走这一个 | 需要 | 2 | 不写 |
| `POST /api/points/earn` | 结算本局积分 | 需要 | — | 写 |
| `POST /api/points/spend` | 用积分换鹰眼 | 需要 | — | 写 |
| `POST /api/eagle-eye/use` | 消耗一次鹰眼 | 需要 | — | 写 |
| `POST /api/eagle-eye/reward` | 看完激励广告加一次鹰眼 | 需要 | — | 写 |

读行数一列是 2026-10-14 在本地 dev 库（2953 个玩家）实测值；榜单和名次是两条 SQL 合计，名次靠 `players_rank` 索引 + `score_buckets` 汇总才只有 5 行，没有它们会退化成全表扫描。

### `/api/user` 字段契约

`players` 表实际只有 6 列：`openid`、`nickname`、`best_score`、`points`、`eagle_eye`、`updated_at`。
`GET /api/user` 返回**除 `openid` 之外的全部 5 列**，再额外带上总人数 `players`（它来自 `player_stats`，不是 `players` 的列）：

```json
{
  "bestScore": 842,
  "bestScoreAt": 1760002856,
  "eagleEye": 3,
  "nickname": "奶蛙2856",
  "players": 2953,
  "points": 0
}
```

- `bestScoreAt` 就是 `updated_at`，表示达成当前最高分的时刻（同分排序要用）；`points` 是 `REAL`，可能带小数（本局分数 ÷ 10）
- 接口是驼峰、库里是下划线，转换只在这一处做；**`openid` 一律不出接口**
- 没有 token → 401；玩家那一行不存在时返回默认值（`eagleEye` = `EAGLE_EYE_INITIAL_COUNT`，其余 0）
- 客户端只有 `utils/player.js` 的 `requestUser()` 调它，`pages/index`、`pages/game`、`pages/result`、`pages/settings`、`components/eagle-eye-drawer` 都从这里取资料；**读接口只剩「个人资料」和「榜单」两个，其余全是写**
- 2026-10-15 删掉了 `GET /api/stats`、`GET /api/points`（新版本小程序都不再调用）：老包再调这两个路径会拿到 404 `{"error":"接口不存在"}`，客户端是静默忽略，不会报错，只是那两处数字不再刷新

### 上线顺序（三条迁移不能反）

1. `cd web; node tools/preflight.mjs --db`（只读，看「待办」）
2. `npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-13-player-points-eagle-eye.sql`
3. `npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-14-players-rank-index.sql`
4. `npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-14-player-stats-buckets.sql`
5. `npx wrangler deploy`（不带 `--env`）
6. 验接口：`curl.exe -s https://milkyfrog.toolsbox.vip/api/user` → 401，`.../api/leaderboard?limit=2` → 200，`.../api/stats` → 404
7. 小程序上传 → 提交审核 → 审核通过后发布

第 2～4 步必须早于第 5 步：新 Worker 的 `/api/user` 和带登录态的 `/api/leaderboard` 要读 `player_stats`、`score_buckets`，表不在就是 500。
详细清单和重复执行注意事项见第十节。
