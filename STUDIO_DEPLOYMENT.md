# Studio 部署与 Cloudflare 配置

Cloudflare CLI 已登录。`tingwoshuo-studio-production`（APAC）D1 已创建并迁移，R2 bucket `tingwoshuo-studio-private` 已绑定。Worker Access、team/AUD 与 `ACCESS_ALLOWED_EMAIL` 已配置，未登录访问会跳转 Access 登录。GitHub App 已安装到 `Yanke00011/tingwoshuo.github.io`；App ID、Installation ID 与 PKCS#8 私钥已存入 Worker Secrets。只读验证了安装令牌、仓库内容读取和 PR 列表读取；未执行过内容写入。不要把密钥写入 Git。

## 0. 费用与配额（2026-11-10 检查）

- **Workers Free：** 100,000 次 Worker 调用/日、每次 10 ms CPU；本应用将 `run_worker_first=true` 用于对每个应用静态资源先执行身份校验，因此页面 CSS/JS 也消耗 Worker 调用额度。超出免费额度或需要更高 CPU 时，需检查 Cloudflare 账户当前计费方案。[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、[Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- **D1 Free：** 每日 500 万 rows read、10 万 rows written，账户 5 GB 总存储、每库最高 500 MB。达到日限后查询会报错直到 UTC 午夜重置。个人写作量通常很低，但保存版本永久增加存储；本项目不自动清理历史。[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- **R2 Standard Free：** 每月 10 GB-month、100 万 Class A、1,000 万 Class B 操作，互联网出站免费；超出按量收费。Cloudflare 首次使用 R2 要在 Dashboard 的 R2 Overview 完成 subscription/checkout 流程。即使使用量在免费额度内，这一步也可能要求添加付款方式；请先检查账户显示的条款再确认。[R2 pricing](https://developers.cloudflare.com/r2/pricing/)、[R2 setup](https://developers.cloudflare.com/r2/get-started/)
- **Cloudflare Access：** Zero Trust 免费档覆盖至多 50 名用户；此工具只配置一位管理员。当前没有已知需要自定义域名的功能，Access 可按 `workers.dev` hostname 建立自托管应用。[Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/)、[Protect a Worker hostname](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

免费额度和计费条件可能随 Cloudflare 政策改变，请创建资源时以账户 Dashboard 的当前提示为准。

## 1. Cloudflare 准备

1. 在 Cloudflare Dashboard → Workers & Pages 设定账户 `workers.dev` 子域名，记下 `<账户子域>`。Worker 名称 `tingwoshuo-studio` 对应地址为 `https://tingwoshuo-studio.<账户子域>.workers.dev`。[Workers.dev 配置](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
2. 生产 D1 已创建并迁移：`tingwoshuo-studio-production`，区域提示为 APAC。仓库根目录的 `wrangler.jsonc` 是生产 Worker 配置，必须提交到 GitHub，供 Workers Builds 部署 Worker 入口、D1 和 R2 绑定。
3. 在 Dashboard → Storage & databases → R2 → Overview 开通 R2。Cloudflare 会进入 checkout；先检查账户显示的计费条款，再自行确认。启用后创建 Standard 私有 bucket：`tingwoshuo-studio-private`。不要启用公开 Development URL 或自定义域名。[R2 开通步骤](https://developers.cloudflare.com/r2/get-started/)
4. 首次 fail-closed Worker 已部署，入口为 `https://tingwoshuo-studio.zhangyanke1010.workers.dev`；随后已完成 Worker Access 保护及 JWT 校验配置。未登录访问会被 Cloudflare Access 拦截。
5. Worker 出现在 Workers & Pages 后，进入 `tingwoshuo-studio` → Access → Protect this Worker behind Access，选择保护生产流量，并只添加一条 Allow 策略：Include → Emails → 你的工作台授权邮箱。不要添加通配邮箱、公共 Bypass 或未经保护的预览流量。保存后在 Manage Cloudflare Access 中读取 Application Audience (AUD) Tag 与 Zero Trust team name。[Worker Access 设置](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
6. 将 `<team-name>` 和真实 AUD 填入 Worker 的 `ACCESS_TEAM`、`ACCESS_AUD`；通过 Cloudflare Secrets 设置 `ACCESS_ALLOWED_EMAIL`，并确保其邮箱与 Access Allow 策略完全一致。再部署一次并验证登录、未授权邮箱拒绝和匿名请求拒绝。

Access 是部署后保护 `workers.dev` Worker 的配置；官方支持 Worker 级别保护，会覆盖该 Worker 的 `workers.dev` URL 和预览地址。不要只依赖应用内 JWT 校验来代替边缘 Access 门禁。[Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

如需 preview，分别新建 preview Access policy、D1 和私有 R2 bucket；不要复用生产数据。

## 2. Cloudflare 配置文件和密钥

本项目生产部署使用仓库中的 `wrangler.jsonc`。它包含非敏感的 Worker 名称、Access AUD 和资源标识；Access 授权邮箱与 GitHub App 私钥等凭据必须保存在 Worker Runtime Secrets，不要写入仓库。Workers Builds 需要仓库里的 Wrangler 配置，才能把 `src/worker.ts`、静态资源以及 D1/R2 绑定一起部署；若配置只存在于本机忽略的 `wrangler.toml`，GitHub 构建会退化为只部署 `dist` 静态文件。

首次从静态资源版本恢复为脚本 Worker 时，先让 GitHub Build 部署 `wrangler.jsonc` 中的 Worker 入口和绑定；该次构建前不要声明 `secrets.required`，否则 Wrangler 会在 Runtime Secrets 尚不可配置时阻止首次部署。应用在所需 Secret 未配置时会 fail closed，返回 401。Worker 脚本部署成功后，再到 Workers & Pages → `tingwoshuo-studio` → Settings → Variables and Secrets 将凭据添加为 Runtime Secret。不要把它们填进 Workers Builds 的构建变量；构建变量只在构建期间可用。

应用 Access 认证邮箱及 GitHub App 凭据用 Worker Runtime Secrets 保存。以下 CLI 命令会立即创建新 Worker 版本并部署；也可在 Worker 已成为脚本 Worker 后通过 Dashboard 添加：

```sh
pnpm exec wrangler secret put ACCESS_ALLOWED_EMAIL --config wrangler.jsonc
pnpm exec wrangler secret put GITHUB_APP_ID --config wrangler.jsonc
pnpm exec wrangler secret put GITHUB_INSTALLATION_ID --config wrangler.jsonc
openssl pkcs8 -topk8 -nocrypt -in /path/to/github-private-key.pem | pnpm exec wrangler secret put GITHUB_PRIVATE_KEY --config wrangler.jsonc
```

CLI 会交互输入 App ID、Installation ID 和邮箱。GitHub 下载的 RSA 私钥若为 PKCS#1 格式，使用上面的 OpenSSL 管道转成 PKCS#8 后直接传给 Wrangler；不要把私钥内容写入命令历史、仓库或聊天。App ID 和 Installation ID 虽不等同私钥，本项目仍作为 Worker Secret 管理。`ACCESS_TEAM` 和 `ACCESS_AUD` 是 Worker 公开配置；Worker 会验证 JWT 签名、Audience 与授权邮箱。

## 3. D1 迁移与保护预览

D1 的生产迁移已完成。缺少有效 Access JWT、正确 Access 配置或 allowlist 时，Worker 始终返回 401；首次部署即使暂未启用边缘 Access，也不会公开静态文件。完成 Access Worker 级保护和 GitHub App Secrets 后进行部署与验证。

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec wrangler d1 migrations apply tingwoshuo-studio-production --remote --config wrangler.jsonc
pnpm run deploy
```

部署后从 Cloudflare 输出复制 `workers.dev` 地址，核对它与 Access 应用 hostname 完全一致。匿名 `curl -I https://<studio-host>/` 应先被 Access 登录拦截；若请求抵达 Worker，应返回 401，而不能收到 Studio HTML。未授权邮箱必须得到 Access 拒绝页。登录后应显示 Studio 工作台。

Preview 用 `wrangler.preview.example.toml` 复制成 `wrangler.preview.toml` 并填入独立资源，命令为 `pnpm run deploy:preview`。为 preview hostname 也创建仅含你的邮箱 Allow policy。不得因预览方便关闭 `ENVIRONMENT=production` 或 Access JWT 验证。

## 4. GitHub App

在 GitHub Developer settings → GitHub Apps → New GitHub App 创建专用 App：

- GitHub App name：`TingWoShuo Studio`。
- Homepage URL：Studio Worker 地址。
- Webhook：不配置 callback/webhook（本版不使用 Webhook）。
- Repository permissions：**Contents: Read and write**、**Metadata: Read-only**。
- 安装范围：Only select repositories，选择 `Yanke00011/tingwoshuo.github.io`。
- 生成 private key 并安全保存；按上面的 PKCS#8 管道将其传给 Wrangler，不要把私钥放进仓库。
- 从 App 设置复制 App ID；安装到仓库后从安装页面 URL 记录 installation ID。只向 Worker 设置这两个 ID。

发布接口只生成指定文章和本次引用的私有图片文件，并以不可强推的快进提交直接更新默认分支；它不创建分支或 PR，也不会触碰其他仓库文件。GitHub Pages/Cloudflare Pages 的生产部署由默认分支提交触发。

## 5. 备份

D1 备份：

```sh
pnpm exec wrangler d1 export tingwoshuo-studio-production --remote --output ./studio-backup.sql --config wrangler.jsonc
```

使用 R2 S3-compatible endpoint 的具备权限凭据工具，将 `tingwoshuo-studio-private` 对象同步到加密备份位置；不要把 S3 secret 写进仓库或 shell history。Studio bucket 是私有对象存储。

恢复时创建隔离 D1/R2，导入 SQL 和对象，验证 Worker 权限与媒体引用，再切换 preview。生产恢复前保留原数据库/桶的只读备份；不要在未确认目标环境时覆盖生产资源。
