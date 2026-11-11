# 听我说项目进度

> 此文件是 Studio 与 Astro 博客两个 sibling repositories 的唯一进度记录。管理文档放在 `tingwoshuo-Studio`；博客仓库的 `AGENTS.md` 指向这里，避免维护两份会逐渐漂移的进度。

## 状态核验

核验日期：2026-11-11（Asia/Shanghai）

| 仓库 | 本地分支与提交 | 本次改动前工作区 |
|---|---|---|
| `tingwoshuo-Studio` | `main`，`4ba113a`（文档补全），与本地远端跟踪引用 `origin/main` 一致 | clean |
| `tingwoshuo.github.io` | `main`，`98dc52a`（Studio: Delete src/content/life/a-morning-without-a-plan.md），与本地远端跟踪引用 `origin/main` 一致 | clean |

V5.0 交付为博客工作区中的本地改动，等待站主预览。Studio 仅更新本文件与 `ROADMAP.md`。既有 Cloudflare 检查记录属于其原提交，本次未重新核验当前提交的远端检查状态。

## 项目组成

- **听我说 Studio**：独立的 React/Vite + Cloudflare Worker 写作与发布后台。D1 保存草稿、修订和发布记录；R2 保存私有图片；Cloudflare Access 与 Worker JWT/CSRF 检查保护应用；GitHub App 操作博客仓库。
- **听我说博客**：Astro 静态站，使用 `life`、`tech` 两个内容集合，构建时生成页面、Pagefind 中文索引、RSS 与 sitemap，并由 Cloudflare Pages 部署。
- 两个项目是两个独立 Git 仓库，位于本机同一目录下；不共享运行时代码。Studio 的 `src/content.ts` 镜像博客的 `src/content.config.ts`，二者的栏目与 frontmatter 契约需要保持一致。
- 博客仓库另外包含 loopback-only 的 `tools/editor/` 本地编辑器，它与在线 Studio 是两个不同工具。

## 已完成的阶段与功能

### 博客

- Astro 静态博客已部署，包含首页、`life` / `tech` 列表与文章页、归档、关于、搜索、404、RSS、sitemap 和 Pagefind。
- 内容集合强制要求非空 `title`、非空 `description` 和有效 `pubDate`；`draft` 项目默认过滤出公开列表和页面。
- 文章 `src/content/life/he-qu-he-cong-ne.md` 的摘要曾为空，导致 Astro Pages 构建失败；现已补为“聊聊稳定工作、回国选择与未来方向带来的迷茫。”。本地此前用 Node 24.22.2 执行 `pnpm build` 成功；Cloudflare Pages 当时对 `8c9173fa` 的检查报告成功。
- 当前 canonical URL 在 `src/config/site.ts` 中为 `https://tingwoshuo-github-io.pages.dev/`。是否切换为自定义域名需以当前 Cloudflare 配置为准。

### Studio

- Cloudflare Worker、Access、D1 与私有 R2 已配置；GitHub App 已安装到博客仓库。Access/GitHub 凭据仅放在 Worker Secrets。
- 已实现登录身份校验、同源/CSRF 写入保护、速率限制、文章路径校验、Markdown/MDX 源码编辑、可视化编辑与预览、IME 组合输入保护、延迟自动保存、离线 IndexedDB 副本、D1 版本历史/恢复、私有 WebP 上传与媒体管理。
- GitHub 仓库文章可读入 Studio；发布前核对文件路径和图片，发布时直接向博客配置的 `main` 分支提交，不建分支或 PR。文章和图片在一个 Git tree/commit 中提交，分支更新使用 `force: false` 并检查 SHA/并发冲突。
- 已修复 GitHub 发布时从 tree 响应中取不到文章 blob SHA 的问题：现在显式创建文章 blob 并使用其返回 SHA。空摘要会在 `src/content.ts` 中回退为文章标题，避免再次生成 Astro schema 无法接受的空 description。
- 草稿删除只删 Studio D1 记录和历史；博客文件不受影响。已发布文章删除 UI/API 已在 `1bacdc07` 实现：校验当前 GitHub 文件 SHA，通过删除 tree entry 创建提交、非强制更新 `main`；关联 Studio 记录及历史会清理，也支持无关联 Studio 草稿的 GitHub 文章。删除 API 对 GitHub 当前 SHA 和分支并发更新做校验，并支持文件已被外部删除后的清理/重试。
- 博客 Git 历史已有 Studio 发起的已发布文章删除提交（例如 `98dc52a`）。V5.0 未操作线上文章或验证生产删除事务。

## 验证证据与边界

- Studio：`pnpm typecheck` 通过；Vitest 现有 8 项测试通过（`tests/content.test.ts` 3 项，`tests/security.test.ts` 5 项）；`pnpm build` 成功。最近一次本机构建仍给出 Node 20.13 低于 Vite 建议版本的提示，以及单个 JavaScript bundle 大于 500 kB 的提示。历史 Workers Build 检查对 `1bacdc07` 成功。
- 博客：修复空 description 后，`pnpm build` 在 Node 24.22.2 下成功，生成 13 个页面和 Pagefind 索引。此前同一次构建出现 Astro “Duplicate id `今天的生活`” 非阻断警告；其来源尚未定位。历史 Pages 检查对 `8c9173fa` 为部署成功。博客 `.nvmrc` 为 `22.23.4`、`package.json` 要求 Node `>=22.23.4`；博客目录当前 shell 报告 Node 24.22.2。Studio 目录当前 shell 报告 Node 20.13.1，Vite 构建虽完成但发出版本警告；应在 Studio 构建时显式切到受支持版本。
- 现有 Studio 测试覆盖内容序列化/校验与安全校验，**没有**覆盖 Cloudflare Worker 的真实 API 路由或 GitHub 发布/删除事务。因此“类型检查和打包成功”不等于发布/删除外部事务已端到端实测。
- 历史 Cloudflare 检查仅对应当时的提交。Studio 目前没有应用内 Pages 构建结果轮询。

## 已知文档/实现差异

- `src/ui/main.tsx` 编辑器说明仍有“准备发布时会先生成 GitHub PR”的文字；当前实现实际直接提交到博客主分支。这是尚未改的 UI 文案问题，列入 Roadmap。
- `STUDIO_DEPLOYMENT.md` 原有“只读验证、未执行过内容写入”的开头已与真实发布历史不符；本次已改为准确说明，并注明已发布删除尚未真实演练。
- `STUDIO_USER_GUIDE.md`、`STUDIO_ARCHITECTURE.md`、`STUDIO_SECURITY.md` 和博客 `README.md` 中发现的本次相关差异已按当前代码修正。仍以本文件和代码为最新进度依据。

## 当前阶段

**V6.1 品牌和媒体编辑已在本地验证，等待站主预览。** Studio 的可靠性工作继续按路线图安排，优先补足发布、删除事务的自动化覆盖并修正 PR 旧文案。

## 博客 V5.0 视觉重构

- 采用现代编辑式版面、暖白与墨色表面、鼠尾草绿点缀。首页收敛为「听」字与写作主题，栏目、精选、最新文章使用自然流动的版面。原创标志及文章源文件、永久链接与依赖保持原样。
- `src/styles/global.css` 定义颜色角色、字阶、4px 间距、圆角、内容宽度和 44px 触控目标。博客 `DESIGN_SYSTEM.md` 记录色值、规则和断点。
- `ArticleLayout.astro` 与 `src/styles/article.css` 共用阅读版式，包含移动折叠目录、代码复制、可滚动表格和键盘可用的图片预览。栏目、归档、关于、搜索、404、Header、Footer 已接入设计系统。静态栏目通过 URL 参数在浏览器中筛选和分页。
- Node 24.22.2、pnpm 9.15.9 下，`pnpm check` 为 0 错误、0 警告、0 提示，`pnpm build` 生成 12 个静态页面及 5 篇文章的 Pagefind 中文索引，`git diff --check` 通过。V5.0 的本地基线及重构后构建均未出现历史重复 ID 警告。RSS、Sitemap、robots 输出与基线一致。
- Chrome 157 与 Playwright WebKit 27.2 分别在 320、360、375、390、430、768、1024、1440px 的浅色与深色主题下检查 9 个路由，每个引擎 144 个组合，未发现页面级横向溢出或栏目重叠。WebKit 在 430px 及以下使用 iPhone 设备模拟。两个引擎确认 Pagefind 搜索、筛选、主题记忆和移动目录，Chrome 另实测围栏代码复制到剪贴板。用临时样例验证 320px 宽表格滚动、长标题换行和图片预览。
- 同口径对比 HTML 与页面直接引用的 CSS/JS gzip 体积，首页约 14.3 → 10.2 KiB，技术文章样例约 18.6 → 18.7 KiB。该数据来自本地构建文件。
- 后续用真实 iPhone Safari 补验系统地址栏、安全区和触控操作。Studio 可参考颜色语义、4px 间距、焦点、44px 触控目标及浅深色映射，工具区密度需单独设计。

## 博客 V6.0 功能冻结改版

- V6.0 从 V5.0 未提交工作区继续实施。博客 `main` 的 HEAD 与本地 `origin/main` 均为 `98dc52a`，Studio 均为 `4ba113a`。本地改动尚未提交、推送或部署。
- 首页重做为深紫墨色刊头、朱橙信号色与原创声波 SVG，替换 V5 的单字主图。栏目、归档、关于、搜索、404、文章标题区和页脚使用同一套颜色角色。原 Logo、文章和构建配置保留。
- `post-presentation.ts` 与 `PostCard.astro` 按内容与位置选择纯文字、封面、配图混排、特写或技术结构版式。配图读取已有 Markdown 图片，无需修改 frontmatter。
- 完整搜索和快捷搜索为标题与摘要增加中英文高亮。保留 Pagefind 的查询、排序和索引行为。当前索引没有标签字段，文章打开后未加入搜索定位。
- 首页入场、插图轻移、区块进入视口和控件反馈使用 CSS 和少量原生 JS。已检查减弱动效设置。SVG 约 11.8 KiB，gzip 约 3.5 KiB，无新增项目依赖。
- Node 24.22.2 / pnpm 9.15.9 下，`pnpm check`（38 文件、0 错误、0 警告、0 提示）、`pnpm build`（12 个静态页面、5 篇索引文章）、`git diff --check` 均通过。Pagefind 目录、RSS、Sitemap、robots 与 V5 基线一致。
- Chrome 157 和 Playwright WebKit 27.2 分别验证 320、360、375、390、430、768、1024、1440px，浅深色各 9 个路由（每引擎 144 个组合）。两引擎均验证搜索高亮、筛选、主题记忆、移动目录、图片预览和滚动容器；Chrome 验证了代码复制。五种文章版式在独立样例中以 320、768、1440px 实测。iPhone Safari 仍待真机验证。
- Studio 可参考颜色语义、标签和状态反馈、可见焦点及减弱动效规则。编辑器、属性面板、发布和删除确认保留适合操作场景的信息密度及现有行为。

## V6.1 品牌与媒体编辑

- 核验基线：博客 `main` 与本地 `origin/main` 均为 `24db5d0`，改动前工作区干净。Studio 均为 `4ba113a`，保留既有 PROGRESS 和 ROADMAP 修改。
- 选用「声纹句点」，博客以 `public/brand/mark.svg` 为源，`scripts/sync-brand.mjs` 生成浅深字标、favicon、Apple Touch Icon、Studio 应用图标、OG 与跨仓库视觉令牌。浏览器检查三方案与 16/32/64/128/180/512px 尺寸。
- 博客封面组件统一使用 16:9，并为无封面、加载中与加载错误使用栏目底图。公开正文保留原图比例及现有灯箱。Studio 共用封面比例和令牌，提供本机裁剪、焦点、六场景预览和 1600×900 WebP 导出。
- Studio 正文和媒体库共用 `media-processing.ts`、`MediaEditor.tsx`、`media-transport.ts`。优化保留长宽比和透明通道，拒绝动画降帧，保持既有 8 MiB WebP API 限制；使用原生 XHR 记录真实上传进度。队列、描述重试和图片选择工具在前端完成。
- Node 24.22.2 / pnpm 9.15.9 下，博客 `pnpm check`（40 文件、0 错误、0 警告、0 提示）、`pnpm build`（12 页，Pagefind 5 篇）及两仓库 `git diff --check` 通过。Studio `pnpm typecheck`、`pnpm build`、`pnpm test`（13 项，新增媒体测试 5 项）通过，Vite 仍有已有的 500 kB chunk 提示。
- 本地 Chrome Mock 验证旧正文图注与代码块、透明截图缩图、竖图、WebP 保留、动画拒绝、编码失败、顺序插入、重复选择、上传失败、描述失败重试、媒体库插入、封面裁剪恢复和 390px 深色预览。博客 320px 检查两主题，独立样例核对真封面和默认封面的标题位置及图片错误回退。未进行生产写入或 iPhone 真机验证。
- 受保护发布能力待单独授权：当前 `createMarkdown` 只收集正文私有图片 key。若支持私有封面随文发布，应在现有预检与发布路径中对 `frontmatter.cover` 的私有引用进行同等 key 校验、R2 对象验证及公开路径替换，使封面与文章继续同一 Git 提交，维持现有身份、CSRF、存储权限及 SHA 校验。现阶段仅导出及设置已公开的封面路径。若要保证连接中断后的上传完全幂等，需另行评估服务端幂等协议。正文宽度与对齐目前仅用于预览，发布继续使用兼容 Markdown 的自适应图片。

## 更新记录

- 2026-11-11：核验两仓库主分支与远端一致；记录最新 Pages/Workers Build 成功；更新删除流程、发布 SHA 修复、摘要回退及验证边界；建立跨仓库会话管理规范。

- 2026-11-11：完成博客 V5.0 本地视觉重构，刷新两仓库提交基线，记录构建和浏览器验证。

- 2026-11-11：完成博客 V6.0 功能冻结改版与本地回归验证。

- 2026-11-11：完成 V6.1 品牌同步、博客封面与 Studio 客户端媒体编辑，验证本地 Mock 上传。
