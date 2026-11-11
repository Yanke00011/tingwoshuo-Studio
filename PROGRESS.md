# 听我说项目进度

> 此文件是 Studio 与 Astro 博客两个 sibling repositories 的唯一进度记录。管理文档放在 `tingwoshuo-Studio`；博客仓库的 `AGENTS.md` 指向这里，避免维护两份会逐渐漂移的进度。

## 状态核验

核验日期：2026-11-11（Asia/Shanghai）

| 仓库 | 分支与提交 | GitHub/Cloudflare 状态 | 本次文档改动前工作区 |
|---|---|---|---|
| `tingwoshuo-Studio` | `main`，`1bacdc07`（`增加删除功能`）；本地 `HEAD` 与 `origin/main` 一致 | Cloudflare `Workers Builds: tingwoshuo-studio` 对应检查完成且成功 | clean |
| `tingwoshuo.github.io` | `main`，`8c9173fa`（`Update he-qu-he-cong-ne.md`）；本地 `HEAD` 与 `origin/main` 一致 | Cloudflare Pages 对应检查完成且部署成功 | clean |

本次工作只改文档，所以完成后两个仓库会各有未提交的管理文档修改；不要把这些修改误认成业务代码。

## 项目组成

- **听我说 Studio**：独立的 React/Vite + Cloudflare Worker 写作与发布后台。D1 保存草稿、修订和发布记录；R2 保存私有图片；Cloudflare Access 与 Worker JWT/CSRF 检查保护应用；GitHub App 操作博客仓库。
- **听我说博客**：Astro 静态站，使用 `life`、`tech` 两个内容集合，构建时生成页面、Pagefind 中文索引、RSS 与 sitemap，并由 Cloudflare Pages 部署。
- 两个项目是两个独立 Git 仓库，位于本机同一目录下；不共享运行时代码。Studio 的 `src/content.ts` 镜像博客的 `src/content.config.ts`，二者的栏目与 frontmatter 契约需要保持一致。
- 博客仓库另外包含 loopback-only 的 `tools/editor/` 本地编辑器，它与在线 Studio 是两个不同工具。

## 已完成的阶段与功能

### 博客

- Astro 静态博客已部署，包含首页、`life` / `tech` 列表与文章页、归档、关于、搜索、404、RSS、sitemap 和 Pagefind。
- 内容集合强制要求非空 `title`、非空 `description` 和有效 `pubDate`；`draft` 项目默认过滤出公开列表和页面。
- 文章 `src/content/life/he-qu-he-cong-ne.md` 的摘要曾为空，导致 Astro Pages 构建失败；现已补为“聊聊稳定工作、回国选择与未来方向带来的迷茫。”。本地此前用 Node 24.22.2 执行 `pnpm build` 成功；Cloudflare Pages 对最新 `8c9173fa` 的检查也报告成功。
- 当前 canonical URL 在 `src/config/site.ts` 中为 `https://tingwoshuo-github-io.pages.dev/`。是否切换为自定义域名需以当前 Cloudflare 配置为准。

### Studio

- Cloudflare Worker、Access、D1 与私有 R2 已配置；GitHub App 已安装到博客仓库。Access/GitHub 凭据仅放在 Worker Secrets。
- 已实现登录身份校验、同源/CSRF 写入保护、速率限制、文章路径校验、Markdown/MDX 源码编辑、可视化编辑与预览、IME 组合输入保护、延迟自动保存、离线 IndexedDB 副本、D1 版本历史/恢复、私有 WebP 上传与媒体管理。
- GitHub 仓库文章可读入 Studio；发布前核对文件路径和图片，发布时直接向博客配置的 `main` 分支提交，不建分支或 PR。文章和图片在一个 Git tree/commit 中提交，分支更新使用 `force: false` 并检查 SHA/并发冲突。
- 已修复 GitHub 发布时从 tree 响应中取不到文章 blob SHA 的问题：现在显式创建文章 blob 并使用其返回 SHA。空摘要会在 `src/content.ts` 中回退为文章标题，避免再次生成 Astro schema 无法接受的空 description。
- 草稿删除只删 Studio D1 记录和历史；博客文件不受影响。已发布文章删除 UI/API 已在 `1bacdc07` 实现：校验当前 GitHub 文件 SHA，通过删除 tree entry 创建提交、非强制更新 `main`；关联 Studio 记录及历史会清理，也支持无关联 Studio 草稿的 GitHub 文章。删除 API 对 GitHub 当前 SHA 和分支并发更新做校验，并支持文件已被外部删除后的清理/重试。
- 上述已发布文章删除尚未在真实线上文章上执行过；没有为了验证而删除任何用户文章。

## 验证证据与边界

- Studio：`pnpm typecheck` 通过；Vitest 现有 8 项测试通过（`tests/content.test.ts` 3 项，`tests/security.test.ts` 5 项）；`pnpm build` 成功。最近一次本机构建仍给出 Node 20.13 低于 Vite 建议版本的提示，以及单个 JavaScript bundle 大于 500 kB 的提示。GitHub 最新 Workers Build 检查成功。
- 博客：修复空 description 后，`pnpm build` 在 Node 24.22.2 下成功，生成 13 个页面和 Pagefind 索引。此前同一次构建出现 Astro “Duplicate id `今天的生活`” 非阻断警告；其来源尚未定位。GitHub 最新 Pages 检查对 `8c9173fa` 为部署成功。博客 `.nvmrc` 为 `22.23.4`、`package.json` 要求 Node `>=22.23.4`；博客目录当前 shell 报告 Node 24.22.2。Studio 目录当前 shell 报告 Node 20.13.1，Vite 构建虽完成但发出版本警告；应在 Studio 构建时显式切到受支持版本。
- 现有 Studio 测试覆盖内容序列化/校验与安全校验，**没有**覆盖 Cloudflare Worker 的真实 API 路由或 GitHub 发布/删除事务。因此“类型检查和打包成功”不等于发布/删除外部事务已端到端实测。
- 两个最新检查状态只说明对应提交的 Cloudflare 构建/部署成功；Studio 目前没有应用内 Pages 构建结果轮询。

## 已知文档/实现差异

- `src/ui/main.tsx` 编辑器说明仍有“准备发布时会先生成 GitHub PR”的文字；当前实现实际直接提交到博客主分支。这是尚未改的 UI 文案问题，列入 Roadmap。
- `STUDIO_DEPLOYMENT.md` 原有“只读验证、未执行过内容写入”的开头已与真实发布历史不符；本次已改为准确说明，并注明已发布删除尚未真实演练。
- `STUDIO_USER_GUIDE.md`、`STUDIO_ARCHITECTURE.md`、`STUDIO_SECURITY.md` 和博客 `README.md` 中发现的本次相关差异已按当前代码修正。仍以本文件和代码为最新进度依据。

## 当前阶段

**线上可用后的可靠性加固与维护文档建立。** 两个最新远端构建均成功；下一步优先补足发布/删除事务的自动化覆盖并修正 Studio 中的 PR 旧文案，再处理构建警告和运维可观测性。

## 更新记录

- 2026-11-11：核验两仓库主分支与远端一致；记录最新 Pages/Workers Build 成功；更新删除流程、发布 SHA 修复、摘要回退及验证边界；建立跨仓库会话管理规范。
