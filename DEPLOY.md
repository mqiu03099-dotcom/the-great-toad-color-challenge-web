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

`push` 不影响线上：这两个 Worker 都没接 Cloudflare 的 Git 自动构建，历史部署来源全是本地 `wrangler` 手动发的（`last_deployed_from: wrangler`）。

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
curl.exe -s https://milkyfrog.toolsbox.vip/api/stats
curl.exe -s https://milkyfrog.toolsbox.vip/api/points
```

`/api/points` 返回 `{"error":"未登录"}`（401）说明新代码已生效；返回 `{"error":"接口不存在"}`（404）说明线上还是旧代码。

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

## 七、上线状态（2026-10-14 记录）

> ⚠️ **当前线上处于危险组合：新代码 + 旧库结构。**
> 线上 Worker 已经在跑新代码（5 个新接口都存在），但线上库还没跑迁移，`SELECT points, eagle_eye FROM players` 会报 `no such column: points`。
> 后果：已登录用户调用钱包类接口（`/api/points*`、`/api/eagle-eye/*`）会 500。现在正式版小程序还是旧包、不调这些接口，所以外部用户暂时没受影响；**但迁移跑完之前不要发布新的小程序版本**。

已完成：

- 测试环境：新 Worker + 空库 `milk-frog-staging`，`https://milkyfrog-dev.toolsbox.vip/api/points` 返回 401，说明新代码在跑

还没上线：

- 线上 Worker **已经是新代码**（2026-10-14T05:53:42Z 的一次部署，`source: wrangler`；不是本手册作者执行的 `--env staging` 那条命令，来源待确认）
- 线上库还没跑 `db/migrations/2026-10-13-player-points-eagle-eye.sql`（加 `points`、`eagle_eye` 两列 + 建 `player_events` 表；里面有一次性给老用户补 10 次鹰眼的逻辑，靠 `legacy-eagle-eye-gift` sentinel 保证只发一次）
- 小程序「积分 / 鹰眼 / 个人信息卡片」这一批还没提交审核

上线顺序：**先跑迁移 → 再 `npx wrangler deploy` → 再提交审核 → 最后发布**

## 八、回滚

- Worker：Cloudflare 面板 → Workers 与 Pages → 该 Worker → 部署 → 回滚到上一版本；命令行是 `npx wrangler rollback`（**未实测**，要回滚先在测试环境试一次）
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
- [ ] 3. 线上库迁移：`npx wrangler d1 execute milk-frog --remote --file=db/migrations/2026-10-13-player-points-eagle-eye.sql`
- [ ] 4. 核对线上库结构：再跑 `node tools/preflight.mjs --db`，线上三个标记必须都是 `OK`
- [ ] 5. 发 Worker：`npx wrangler deploy`（**不带 `--env`**；带 `--env staging` 发的是测试环境，别搞反）
- [ ] 6. 验证接口：`curl.exe -s https://milkyfrog.toolsbox.vip/api/points` 应返回 401 `{"error":"未登录"}`；返回 404 说明还是旧代码
- [ ] 7. 线上真机过一遍：积分累计、鹰眼兑换、个人信息卡片、结果页最佳纪录
- [ ] 8. 小程序：上传 → 提交审核 → 审核通过后发布
- [ ] 9. 回填第十一节的记录

顺序不能反：第 3 步没做就做第 5 步，新接口会 500；反过来先 deploy 后迁移，只有新接口不可用，补跑迁移即可恢复，老功能不受影响。

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

## 十二、隔久了怎么恢复上下文

三步，两分钟：

1. 读本文件，重点看第一、二、三、七、十节
2. `cd web; node tools/preflight.mjs --db`——「待办」会直接告诉你线上还差哪一步
3. 需要本机级细节（wrangler 登录位置、本机踩过的坑）看记忆笔记：
   `C:\Users\blbq2\.codex\memories\extensions\ad_hoc\notes\20261014-121613-the-great-toad-envs-and-deploy.md`

**什么时候必须回来改这个文件**：改域名 / 建新库 / 加新迁移脚本 / 改上线顺序 / 每次上线跑完（追加第十一节）。

**最容易丢的几件事**：

- 迁移脚本忘了跑，新接口 500
- `deploy` 的 `--env` 带错方向，把测试发成了线上（或反过来把线上发成测试）
- 改了 `constants/wechat-login.js` 的域名映射，但没重新上传体验版，测试环境不生效
- 微信后台的 request 合法域名没加新域名（每月只有 5 次修改机会，先想清楚再改）
