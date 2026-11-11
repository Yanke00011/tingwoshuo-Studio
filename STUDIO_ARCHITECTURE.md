# Studio 架构说明

## 独立项目

`/Users/yankezhang/Documents/GitHub/tingwoshuo-Studio` 与公开博客仓库并列，是单独的 pnpm 项目。Cloudflare Worker 用 `assets.run_worker_first = true` 在所有静态文件和 API 前运行 JWT 检查；Worker 通过同源 `/api/*` 提供功能。博客 `pnpm build`、GitHub Pages 仓库与文章路由都不包含 Studio 文件。

```text
src/ui/            React + Tiptap 编辑器
src/worker.ts      Access、CSRF、D1、R2 和发布 API
src/security.ts    Cloudflare Access JWT 与同源写入校验
src/github.ts      GitHub App installation token 与 API
src/content.ts     frontmatter、内容校验与发布导出
migrations/        D1 schema
wrangler*.toml     本地配置和生产/预览模板
```

## 写入与版本

- D1 `drafts` 保存编辑器 JSON、Markdown、Frontmatter、revision、GitHub 文件 SHA。
- 每次保存用 `If-Match` / revision 执行比较并交换；两个设备基于旧 revision 保存时返回 409，不覆盖远端。
- D1 `draft_versions` 保留每个 revision，当前没有自动清理策略。
- 写入成功后显示 D1 revision；离线时当前设备用 IndexedDB 暂存，重连后提示恢复。离线内容不会自动覆盖服务器版本。
- 媒体只放在无公开绑定的私有 R2 bucket，并通过 Access JWT 保护的 Worker 路由读取。
- Markdown/MDX 正文在源码模式下逐字保留。未知 Frontmatter 键和值在 YAML 解析/生成时保留语义；YAML 注释与原有排版可能规范化。MDX/JSX、HTML、带围栏元数据的 Markdown 文章默认进入源码模式。

## 图片发布

图片在浏览器画布中缩放并重新编码 WebP，再写入私有 R2。正式 Markdown 只在用户确认后直接提交到 GitHub 默认分支；被正文引用的私有 key 在同一次 Git Tree 中映射成 `public/images/<uuid>.webp`，文章内链接转换为博客 `/images/<uuid>.webp`。Studio API 不提供任何公开 R2 URL。

## 发布事务

Worker 创建短期 GitHub App installation token。发布会读取默认分支最新提交、验证原文章 blob SHA、创建文章 blob 与引用图片 blob、组装 Git tree 并创建提交，再用 `force: false` 快进更新默认分支 ref；不创建发布分支或 Pull Request。删除已发布文章会读取默认分支快照、核对当前文件 SHA、用 `sha: null` 从新 Git tree 移除目标文章并创建删除提交，再以 `force: false` 更新分支。若分支在操作期间前进，GitHub 会拒绝更新；Studio 不应覆盖并发提交。已发布文章删除成功后会清理关联 D1 草稿、版本与发布记录；GitHub-only 文章只删除仓库文件。Cloudflare Pages 由默认分支提交触发；当前不跟踪构建结果，线上删除流程尚未在真实文章上演练。

## 共享内容模型

Studio 与 Astro 没有运行时共享代码，以免增加博客构建依赖。文章路径、栏目枚举、Frontmatter Schema 与转换规则在 Studio `src/content.ts` 中镜像博客 `src/content.config.ts`。发布前后使用博客的 `pnpm check` 与 `pnpm build` 验证生成内容。
