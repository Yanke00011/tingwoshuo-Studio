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

## 图片发布（当前生产与 V7 目标）

图片在浏览器画布中缩放并重新编码 WebP，再写入私有 R2。生产当前在用户确认后把正式 Markdown 和图片提交到 GitHub 默认分支。V7 本地 D1 模式以 `article_media` 将私有 R2 对象关联到文章版本；公开博客 Worker 只为当前已发布 revision 关联的图片提供短缓存读取，不公开 bucket URL。生产尚未切换。

## 发布事务（双轨过渡）

生产当前仍运行 GitHub 事务：Worker 创建短期 GitHub App installation token，校验源文章 SHA，提交 Markdown 与引用图片并以非强制快进更新默认分支；Cloudflare Pages 随后构建。V7 的隔离 D1 backend 保存不可变 article versions 和 published revision，支持创建草稿、乐观并发编辑、发布、撤回、软删除与恢复；草稿编辑不会改变当前公开快照。Studio 生产环境默认仍为 GitHub，生产 D1/R2 尚未导入，切换必须先完成全备份、隔离 Cloudflare 验收并取得明确批准。过渡期间保留旧 GitHub 文件和发布流程。

## 共享内容模型

Studio 与博客没有共享运行时代码。V7 schema 位于 `migrations/0002_v7_articles.sql`；导入工具读取博客 Git Markdown，保持 section/slug 永久链接和源 Markdown hash。博客运行时读取已发布 revision，并使用受控 Markdown 渲染和 sanitize。完整 MDX 自定义组件/表达式兼容性仍待盘点；当前 5 篇 `.md` 已在隔离 D1 验证导入。实际证据以 canonical `PROGRESS.md` 为准。
