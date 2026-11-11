# TingWoShuo Studio

听我说 Studio 是与 Astro 博客分开的私人写作应用，部署在独立的 Cloudflare Worker 上。前端使用 React、Vite、Tailwind CSS 4 和 Tiptap；Worker 同源托管前端、D1 草稿与历史、私有 R2 媒体，以及通过 GitHub App 将文章直接提交到博客主分支的发布 API。

## 本地开发

要求 Node.js 22.23.4+、pnpm 9+。首次安装后运行：

```sh
pnpm install
pnpm db:local:migrate
pnpm dev
```

浏览器打开 <http://127.0.0.1:5180>。本地模拟身份 `you@local.invalid` 只在 `wrangler.dev.toml` + loopback 开发环境生效，生产 Worker 不接受该身份。开发环境使用本地模拟的 D1 和 R2。

## 构建与测试

```sh
pnpm typecheck
pnpm test
pnpm build
```

部署模板需在手动创建 Cloudflare D1、R2、Access 应用后填写真实资源 ID；说明见 [STUDIO_DEPLOYMENT.md](STUDIO_DEPLOYMENT.md)。

## 文档

- [Codex 会话与开发规范](AGENTS.md)
- [跨仓库开发进度](PROGRESS.md)
- [后续路线图](ROADMAP.md)
- [架构说明](STUDIO_ARCHITECTURE.md)
- [部署步骤](STUDIO_DEPLOYMENT.md)
- [使用指南](STUDIO_USER_GUIDE.md)
- [安全说明](STUDIO_SECURITY.md)
