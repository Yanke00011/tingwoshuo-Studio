# Studio 安全说明

## 已实现

- Worker 对每个页面、静态资源和 API 请求验证 Cloudflare Access JWT：RS256 签名（Cloudflare 公钥 JWKS）、issuer、audience、`exp`/`nbf`，并精确比较 `ACCESS_ALLOWED_EMAIL`。不信任 email 请求头。
- Access 在 Cloudflare 边缘先保护整个 `workers.dev` hostname；Worker 配置 `run_worker_first = true`，即使命中静态资源也先过身份检查。
- 写请求校验同源 `Origin`、拒绝跨站 Fetch Metadata，要求 HttpOnly/SameSite=Strict CSRF Cookie 与内存中的 CSRF header 匹配。
- 不启用 CORS。GitHub App 私钥和允许邮箱只通过 Worker Secrets；短期 installation token 仅留在 Worker 运行内存。
- 文章路径允许列表、Slug 校验、竞态 SHA/revision 检查、正文与 JSON 尺寸上限、私有 R2 对象签名校验、图片 8 MiB 限额、每用户写入速率限制；已发布文章的 GitHub 删除额外限为每小时 5 次，并校验当前文件 SHA、通过 `force: false` 防止覆盖并发提交。
- 编辑器源码不使用 `dangerouslySetInnerHTML`；预览在无脚本 sandbox iframe，附带 CSP。

## 本地例外

`wrangler.dev.toml` 仅供 loopback 开发，`ENVIRONMENT=development` 且请求 URL hostname 为 `127.0.0.1` 时使用本地身份。生产/预览配置设置 `ENVIRONMENT=production` 并且没有本地身份配置。不要把 dev 配置拿去部署。

## 外部配置责任

部署者仍须在 Cloudflare Access 为完整 `workers.dev` 主机创建 deny-by-default 自托管应用，只加自己的已验证邮箱 Allow policy；限制预览主机也必须独立启用 Access。若只保护博客域名或 Pages 地址，Studio Worker 不会因此自动受保护。

D1 保存私密文章明文与历史；R2 bucket 不应绑定公共自定义域名，也不要公开 bucket。Cloudflare 账户管理员和获得 GitHub App 权限的主体仍可管理对应数据。

## 尚未实现的强化

没有专门的恶意内容净化服务、异地自动备份、GitHub Webhook 签名处理、Pages 部署状态轮询、未使用媒体的静态分析或多管理员审批。对富文本无法安全解析的 MDX/HTML 使用源码模式；发布前由作者核查预览。R2 图片只在明确确认发布时导出至博客仓库；未引用的公开图片不会在删除文章时自动清理，避免误删共享资源。
