# 听我说项目进度

> 此文件是 Studio 与 Astro 博客两个 sibling repositories 的唯一进度记录。管理文档放在 `tingwoshuo-Studio`；博客仓库的 `AGENTS.md` 指向这里，避免维护两份会逐渐漂移的进度。

## 状态核验

核验日期：2026-11-12（Asia/Shanghai）

| 仓库 | 本地分支与提交 | 本次改动前工作区 |
|---|---|---|
| `tingwoshuo-Studio` | `main`，`97afb339`，与本地远端跟踪引用 `origin/main` 一致 | V7 本地改动，未提交 |
| `tingwoshuo.github.io` | `main`，`8cc6ad8b`，与本地远端跟踪引用 `origin/main` 一致 | V7 本地改动，未提交 |

V7.0 架构迁移仍处于本地实现和隔离验证阶段。生产 D1/R2 未读取或写入，生产发布链路和 Pages 配置未切换；未推送或部署。上述提交 hash 为本次改动前的真实基线。既有 Cloudflare 检查属于历史提交，本次未查询远端状态。

## 项目组成

- **听我说 Studio**：独立的 React/Vite + Cloudflare Worker 写作与发布后台。D1 保存草稿、修订和发布记录；R2 保存私有图片；Cloudflare Access 与 Worker JWT/CSRF 检查保护应用；GitHub App 操作博客仓库。
- **听我说博客**：Astro 5 + Cloudflare Workers SSR；V7 本地分支从隔离 D1 读取发布版本，RSS、sitemap 与搜索也由 D1 生成。生产当前仍按旧 GitHub Markdown + Cloudflare Pages 流程运行，只有经用户确认切换后才改变。
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

**V7.4 已完成独立 Cloudflare Pages SSR Staging 部署及真实云端内容、搜索、SEO、R2 媒体和响应式检查；生产切换仍阻塞于生产备份授权/执行、全量历史对账和生产切换批准。**

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

## V7.0.1 数据模型、备份与迁移演练

- 两仓工作区基线为 Blog `8cc6ad8b5426a95a4ee81aee9cca73a22158c9e3`、Studio `97afb3391a432bdc17d8fb6068f9b60d8faf7197`；均在 `main` 且基线与 `origin/main` 一致。无生产 Cloudflare 访问或更改。
- Studio 新增 `migrations/0002_v7_articles.sql`：规范化文章、不可变版本、版本化媒体关系和旧数据导入记录；published revision 指针隔离公开快照与后续草稿编辑；SQLite FTS trigram 索引只收录当前发布版本。旧 drafts、media、publish_jobs 等表保留。
- `scripts/v7-backup.mjs` 生成仓库外的哈希清单和源文件副本；`scripts/v7-export-legacy.mjs` 默认只做 dry-run，导出可幂等应用的 SQL，并限制写入目标为 migration-test。已将当前 Git 文章源码 5 篇复制到 `/Users/yankezhang/Documents/GitHub/tingwoshuo-v7-backup-2026-11-11`；因为没有 D1 导出与 R2 清单，该备份被明确标记为不完整。dry-run 接受 5/5，保留 slug、源码哈希，0 正文媒体引用。
- 用隔离的本地 D1（Blog 和 Studio 各自 Wrangler 本地状态）应用 schema 并导入了 5 篇历史 Git 文章。未包含 Studio 私有草稿或私有 R2 图片，生产文章未用于破坏性测试。
- Studio Worker 本地 D1 模式新增文章草稿、乐观版本写入、发布、撤回、软删除、恢复、版本查看/恢复 API；保留现有身份、CSRF、same-origin 和限流校验。发布时验证 R2 引用，并仅索引公开版本；媒体仍被发布文章或历史版本引用时拒绝删除。Studio UI 在本地 D1 backend 下接入新 API；生产默认仍为 GitHub backend。
- 博客改为 Workers SSR 读取已发布且未过发布日期的 published revision；首页、栏目、归档、文章、相关内容、搜索、RSS、sitemap 与受控 R2 图片路由均从 D1 读取。文章正文在运行时渲染并 sanitize；没有公共写端点。Pagefind 已移除，搜索使用 D1 FTS/短中文 LIKE 回退。
- V7.0.1 当时的最终验证（Node 24.22.2）：Blog `pnpm check` 0 errors/warnings/hints；`pnpm build` 成功输出 Worker，`git diff --check` 通过。Astro Cloudflare adapter 输出 KV session 提示及 Sharp 运行时提示（没有 invalid binding 错误）；V7.1 已改用 passthrough 图片服务并准备独立 staging KV 绑定。Studio `pnpm typecheck` 通过，`pnpm test` 13 项通过，`pnpm build` 成功，`git diff --check` 通过；当时 Vite 有 969.02 kB chunk warning。浏览器实际打开首页、技术列表和 Astro 文章，确认公开内容、目录、代码复制控件、上一篇/相关阅读；HTTP 核对闲聊、搜索、RSS 与 sitemap。合成 canary 验证草稿不公开、发布/修改公开快照、撤回下线与搜索摘除，随后在隔离 D1 清理 canary。
- 运行时安全烟测通过：注入 `<script>`、事件属性和 `javascript:` URL 均被移除；heading slug、代码高亮与受控 Callout 正常。未做完整渗透测试、真实手机 Safari 测试、所有指定 viewport 逐一复核，亦未使用真实 Cloudflare preview bindings/R2。
- 上线阻塞项：必须先取得用户确认的生产只读 D1/R2 导出，补齐涵盖 Studio 草稿/版本、发布作业、媒体对象与关系的完整备份和核对；审查 MDX 组件兼容性；准备并验证非生产 Cloudflare D1/R2/KV 环境与 Worker bindings；完成隔离环境端到端 UI/API、安全、恢复演练。当前源代码备份不是完整备份，不能据此切换生产。
- 无自动推送、生产资源操作、生产部署、Access 改动、旧 GitHub 文件删除或旧工作流关闭。

## 更新记录

- 2026-11-11：核验两仓库主分支与远端一致；记录最新 Pages/Workers Build 成功；更新删除流程、发布 SHA 修复、摘要回退及验证边界；建立跨仓库会话管理规范。

- 2026-11-11：完成博客 V5.0 本地视觉重构，刷新两仓库提交基线，记录构建和浏览器验证。

- 2026-11-11：完成博客 V6.0 功能冻结改版与本地回归验证。

- 2026-11-11：完成 V6.1 品牌同步、博客封面与 Studio 客户端媒体编辑，验证本地 Mock 上传。

- 2026-11-11：按场景调整博客封面尺寸。普通闲聊列表无图时为文字条目，有图时使用 16:9 侧边缩略图。首页精选和文章详情的真实封面保留较大尺寸。博客 `pnpm check`、`pnpm build` 和 `git diff --check` 通过，Chrome 验证了 320、390、1440px 深色列表、真实缩略图和加载失败回退。

- 2026-11-11：技术栏目沿用闲聊列表的封面尺寸规则。无图条目省去占位图，有图条目用 16:9 侧边缩略图，保留技术元信息。博客 `pnpm check`、`pnpm build`、`git diff --check` 通过，Chrome 核对了 320 和 1440px 的深色列表及有图样例。

- 2026-11-11：开始 V7.0.1 本地 D1 数据模型、受限迁移工具、非完整源文件备份与隔离导入。实现博客动态只读、Studio 本地 D1 写/发布工作流及隔离 API 演练；生产迁移、配置切换和部署均待后续授权及凭据。记录当前构建、测试证据和未完成风险。

## V7.1 生产数据保护与 Cloudflare 隔离验收准备

- 按要求恢复并核对两仓上下文：博客 `main` HEAD/origin 为 `8cc6ad8b5426a95a4ee81aee9cca73a22158c9e3`，Studio `main` HEAD/origin 为 `97afb3391a432bdc17d8fb6068f9b60d8faf7197`。保留原有 V7 工作区改动；没有创建分支、提交、推送或部署。
- 将 `scripts/v7-backup.mjs` 扩展为完整备份打包门槛：要求生产 D1 SQL 导出、R2 全量清单和对象副本、Git Markdown/MDX 与公开图片、age 公钥/私钥；清点 D1 旧表、逐对象核对 R2 key 集合、生成文件大小与 SHA-256 清单、加密归档并解密检查压缩包目录，成功后移除明文 staging 目录。`--source-only` 只用于明确标为不完整的源码副本。此前仅完成了 5 篇 Git 文件源备份；本次未导出生产 D1/R2。当前机器未安装 `age`/`aws`，合成完整归档验证因缺少 age 工具停止并清理输出，因此不能称完整加密备份或恢复能力已实测。精确站主操作步骤见 `V7.1_CLOUDFLARE_STAGING_RUNBOOK.md`。
- 新增 Studio `wrangler.staging.example.toml` 与博客 `wrangler.staging.example.jsonc`，资源 ID 均为占位符；本地 `wrangler deploy --dry-run` 分别成功解析 Studio D1/R2、Blog D1/R2/KV bindings。没有运行 `wrangler login`、创建资源、部署 Worker、修改 Access 或触达生产。博客 Worker 的独立 KV 与 Studio 独立 Access 应用必须在 staging 建立后填入真实 staging 值。
- V7.1 当前运行时兼容改动：Blog 设为 `imageService: 'passthrough'`，移除未使用 Sharp 图像服务路径；staging 全站 noindex，canonical、OG、JSON-LD、RSS 与 Sitemap 指向 staging origin，robots 禁止抓取；受控 MDX 支持静态导入 `Callout`、`ImageFigure`、`Steps` 并拒绝任意脚本/import。`pnpm v7:render:check` 通过，覆盖中文标题、允许组件与列表、表格/高亮、危险 HTML 清理及未知导入拒绝。既有文章源中无 MDX 文件；动态/未知 MDX 扩展仍需从实际内容清单确认。
- Studio staging 非开发环境 Cookie 增加 Secure；媒体编辑器/图片工具改为按需加载，功能保留。Studio Node 24.22.2 下 `pnpm typecheck`、`pnpm test`（13/13）和 `pnpm build` 通过；媒体 chunks 分别为 2.36/13.76 kB，主 chunk 954.36 kB（gzip 300.27 kB），仍有 Vite >500 kB 警告。Blog Node 24.22.2 下 `pnpm v7:render:check`、`pnpm check`（48 文件，0 error/warning/hint）、`pnpm build` 均通过。Astro build 提示启用 SESSION KV；这是本地构建缺少 Cloudflare 运行时绑定时的适配器提示，staging 模板含独立 KV；没有真实远程绑定验证。
- 认证 staging E2E 已于 2026-11-11 开始并完成核心内容/媒体路径；详细边界见下方执行更新。并发冲突、模拟服务错误恢复、旧 slug 兼容、封面媒体读取、R2 备份恢复和 Worker rollback 仍未实测。
- Worker 回滚与备份恢复只完成手册设计，没有真实 staging 演练；D1 restore、R2 restore、迁移重复执行、发布一致性及新旧系统路由往返尚未验证。当前不可上线的原因：缺完整生产只读备份、完整 restore 演练、真实隔离 Cloudflare E2E、正式历史数据/媒体关系校验及运行时绑定确认。生产 D1/R2/KV、Access、部署、GitHub push 与旧发布链路均未操作。

### V7.1 更新记录

- 2026-11-11（Cloudflare staging 执行更新）：站主授权接入 Cloudflare 并同意创建仅允许 `zhangyanke1010@gmail.com` 的独立 staging Access 应用。已创建隔离资源：D1 `tingwoshuo-studio-v7-staging`（`fc9631f7-1a1b-4e26-bc0d-581417779b1a`）、R2 `tingwoshuo-v7-staging-media`、Blog SESSION KV（`4c2c05addb004898a36e1723f388e116`）。仅在全新 staging D1 应用 Studio `0001_initial.sql` 和 `0002_v7_articles.sql`，重复运行迁移显示无待应用项；只读 schema 查询确认所需表存在，文章与版本数均为 0。生产 D1/R2/KV 未读取或写入。
- 已部署 Blog Worker `https://tingwoshuo-blog-v7-staging.zhangyanke1010.workers.dev` 与 Studio Worker `https://tingwoshuo-studio-staging.zhangyanke1010.workers.dev`。Studio Access 使用独立应用和可复用的精确邮箱 Allow policy，未修改生产 Access 策略；staging Worker `ACCESS_ALLOWED_EMAIL` 与 Access JWT audience 已配置。无凭据请求 Studio 首页和 `/api/session` 均被重定向到 Access 登录；浏览器确认 staging Blog 首页实际可打开、当前为空内容，并确认 Studio 到达 Access 登录门。未提供/输入邮件 OTP，故没有已认证 Studio 会话。
- 部署时发现 Wrangler 可能将 `dist/_worker.js` 当公开静态资产暴露；博客增加 `public/.assetsignore` 排除 `_worker.js` 后重新部署成功。已更新 Git ignore，真实本地 staging Wrangler 配置含 Cloudflare 资源 ID 且不跟踪；模板仍用于可复建参考。Studio staging 使用 `CONTENT_BACKEND=d1`，博客绑定同一 staging D1/R2 和独立 SESSION KV。staging Blog 保持 noindex、robots 禁止索引。
- 真实 Cloudflare E2E 尚未完成：创建/自动保存、历史版本、发布、博客动态读取、中文搜索和高亮、撤回/恢复/软删、媒体上传/读取、RSS/Sitemap/SEO、旧 slug、并发冲突与错误恢复均未在已认证 Studio 会话中测试。当前 D1 为空，没有合成文章写入。Cloudflare 部署成功与空白博客首页 smoke 不能替代完整验收。
- 生产只读备份仍未执行：本机没有挂载加密备份卷，也未安装 `age` / `aws`，缺少限定正式 bucket 的 R2 只读 S3 凭据。此前 5 篇 Git 源文件副本仍标记为不完整备份。未导出生产 D1、未列举或下载生产 R2，也未做 restore。请按 runbook 准备加密存储和专用只读 token；不要将导出落到普通工作区磁盘。
- 当前不能上线：缺生产完整备份及隔离 restore、全部 staging E2E、历史草稿/版本/R2 对象关系及哈希对账、迁移一致性/发布期间并发测试和完整回滚演练。Worker 回滚、D1/R2 restore、新旧系统切换均未实测。当前 Cloudflare 资源只用于 staging，不改生产路由、旧 GitHub 发布链路或生产数据。
- 本次 staging Wrangler 文件保存在各仓库被 Git 忽略的 `wrangler.staging.toml` / `wrangler.staging.jsonc`；不要提交或公开这些本地配置。
- Cloudflare 执行后的最终本地回归：Blog `pnpm check` 48 文件 0 errors/warnings/hints，`pnpm build` 成功，`pnpm v7:render:check` 通过；Astro build 显示 `SESSION` KV 提示，staging config 已配置独立 KV。Studio `pnpm typecheck` 通过，`pnpm test` 13/13 通过，`pnpm build` 成功；Vite 仍报告 954.36 kB 主 bundle（gzip 300.27 kB）。两仓 `git diff --check` 均通过。以上为本地构建，不能替代 staging 已认证端到端验收。

### 2026-11-11 已认证 staging E2E 执行更新

- 站主完成 staging 登录。通过 Studio UI 创建合成文章 `七点一隔离验收 合成草稿`，观察 D1 自动保存与连续版本；版本历史可查看并恢复为新版本。发布后博客 workers.dev 详情立即读取 D1 内容，不需 GitHub commit/build；中文搜索词可命中并在标题/正文高亮。发布期间 RSS 与 sitemap 包含该 canonical URL，撤回后详情变 404 且 RSS/Sitemap 移除该条。历史恢复后明确仍为私有草稿；之后软删除并恢复，恢复结果是私有草稿，重载博客详情仍为 404。
- 同一合成流程上传 WebP 到私有 R2，再将媒体库图片插入正文；博客发布后 `/media/private/<key>` 返回可渲染图片，浏览器 `img.complete=true`、自然尺寸 `320×180`、Alt 为“合成验证图”。媒体库 thumbnail/列表也成功读取。Safari UI 一次直接 PNG 导入报“浏览器无法导出 WebP”，没有写入失败文件；转换为 WebP 后上传成功。合成记录现为已恢复的 staging 私有草稿，测试媒体继续留在 staging R2；未执行不可逆清理。
- 未认证 staging Studio `/api/session` 与 `/api/v7/articles` 的直接请求均返回 Cloudflare Access `302` 登录重定向。staging Access 限定邮箱策略保持开启，未修改生产策略。
- 未覆盖：并发编辑冲突的双会话验证、API/存储失败注入与错误恢复、旧 slug/重定向兼容、专用封面上传→公开渲染、SEO OG/结构化数据逐项断言、Worker 版本回滚、D1/R2 真恢复、新旧路由往返、全量历史数据计数/hash 对账。此前只在 staging 空 D1 对 migration 重复执行验证过幂等，未在含测试文章数据的库重复回滚/重放 migration。合成文章原始输入经 Safari 原生文字输入发生字符丢失；后续恢复的是历史版本，故应再用可验证的中文粘贴输入核查正文完整性。
- 生产只读 D1/R2 备份仍未执行，缺加密存储和正式 bucket 专用只读凭据；未访问或改变生产 D1/R2/KV、Access、GitHub 发布链路或生产 Worker。当前不可上线的原因仍包括完整生产备份与恢复实测、未覆盖 staging 测试、历史数据 hash/引用对账以及回滚演练。
- 本轮状态复核：博客 `main` HEAD/origin `8cc6ad8b5426a95a4ee81aee9cca73a22158c9e3`，Studio `main` HEAD/origin `97afb3391a432bdc17d8fb6068f9b60d8faf7197`；两仓保留既有未提交 V7 改动，没有 commit/push。直接未认证请求返回 Cloudflare Access `302` 登录重定向。需要重新 `git diff --check` 确认本次文档编辑。


## V7.2 staging 最终安全验收更新（2026-11-12）

本节覆盖并更新上方 V7.1「未覆盖」和「尚未」状态。所有新写入均限定于隔离 staging D1/R2 合成数据；未读取、写入或导出生产资源，没有生产部署、推送、域名切换、生产 Access 修改或关闭旧 Git 发布链路。两个仓库现有未提交 V7 改动均保留。

### 并发、故障与页面关闭

- 同一文章的两个并发客户端以 revision 1 保存不同正文：初测赢家返回 200，输家因版本行重复曾返回 400。修复为版本快照插入幂等保护并比较最终内容 hash 后，回归结果是一个 200、一个 409 conflict；D1 最终 revision 2，内容只保留赢家，没有静默覆盖。
- 文章编辑与删除并发：一个更新成功，另一个返回 409；最终状态为 draft/revision 2，赢家正文完整。旧 revision 的后续保存返回冲突。
- 重复发布同一 revision/content hash：首次发布 200，重复请求 200 `alreadyPublished=true`。修复了草稿与发布快照 hash 形状不同导致重复请求 409 的判断。
- 发布 D1 故障注入：仅对一条合成文章建立 `article_versions` abort trigger。发布返回 400；D1 batch 原子回滚，文章仍是 draft、revision 1、published_revision NULL。注入 trigger 随后移除。
- R2 上传失败：新增 Worker 单元测试覆盖媒体上传成功、D1 media insert failure 和 R2 put failure；前者不写 R2，后者补偿删除 D1 与 R2 记录。3 项测试通过。R2 网络超时后客户端可能不知道是否成功的处理仍须使用失败提示/重试核验；随机 object key 不构成跨请求 exactly-once。
- 关闭未保存页面：在 2.2 秒自动保存窗口内关闭本地测试编辑器，beforeunload 同步写入本地副本；重开后显示恢复提示，确认后标题与正文均恢复。此项为 UI 实测。
- 请求重复与超时：重复 publish 已验证幂等；PUT 的响应丢失后客户端旧 revision 重试会得到明确 409，数据仍可通过版本查看/恢复，不会静默覆盖。没有用公网代理注入真实超时。撤回后文章、RSS/Sitemap/search 下线此前已通过 V7.1 E2E；本次未复测已通过项。

### D1/R2 恢复、历史与 SEO

- Cloudflare staging 新建隔离 source/restore D1 与 restore R2。因为 FTS5 存在，标准 D1 全库 export 返回「cannot export databases with virtual tables」；过滤应用管理的 base tables 后做 data-only export，先在空 restore D1 应用相同 migrations，再导入。恢复后核对 6 articles、6 versions、1 media、2 article_media 关系、6 个 FTS 公开索引记录、0 断链媒体；比较行字段及 body hash 均匹配。
- 合成 WebP 从 staging R2 下载、写入新 restore bucket、重新读回 SHA-256 一致：`79ea3317780c530df4b4f46f88fa02fe28094f255a4c01d90f8a3d08c92e76d3`。恢复后的 Worker 页面浏览器确认长中文标题、封面、正文图片/图注、代码块、tags、canonical、OG、BlogPosting JSON-LD 与图片正常显示；页面 noindex/nofollow。
- 5 篇本地历史 Git 文章副本导入隔离 D1：slug 保持，body Markdown 逐字一致且 hash 匹配；抽样页面可渲染，技术代码块、标签和栏目正确，RSS 包含旧 slug。此样本无媒体引用，不含生产草稿/历史版本/R2；不代表全量文章迁移验收。
- 在隔离 Blog Worker 上 HTTP sitemap 为 200、合成文章详情浏览器正常、缺失路径浏览器展示 404 且 HTTP 404 已由命令实测。Shell 代理对 sitemap/RSS body 返回 403，未以该通道断言内容；staging RSS 与 sitemap 条目变化采用此前已认证浏览器验收结果。

### Worker 回滚及剩余切换演练

- 对独立 restore-test Blog Worker 部署第二个 staging 版本，再回滚到已知版本 `586ba91f-e4d6-4a68-a5f9-979c92c70c1f`；Wrangler 返回 100% traffic success。回滚后文章和恢复媒体仍可用。Cloudflare 的回滚只切换 Worker 版本，不恢复 D1/R2；数据恢复已通过独立目标资源流程测试。
- 未演练生产旧 Pages 与 V7 路由/DNS 切换；未触碰生产域名。没有在 staging restore 后做回切 DNS/route，因为当前验收 Worker 使用隔离 workers.dev 名称。

### 生产备份与上线判定

- 生产 D1/R2 未访问或导出；没有生产对象清单、hash、加密包或恢复验证。机器缺少 `age`、`aws` 与外置加密备份卷，R2 生产专用对象只读凭据亦未配置。
- 重要限制：Cloudflare `wrangler d1 export --remote` 需要 D1 Write 权限，并在导出期间锁定数据库，因此不能准确描述为严格只读备份操作。标准 export 对 FTS5 虚拟表失败；当前生产旧架构是否含 FTS5 必须在单独授权后核对。runbook 已记录权限、锁定影响和停止条件。Cloudflare 官方说明：[D1 export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/)、[D1 export API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)、[R2 token permissions](https://developers.cloudflare.com/r2/api/tokens/)。
- 生产备份的唯一待执行步骤：站主单独授权 D1 导出及 R2 读取、准备加密卷和 age/aws、确认低峰窗口与 D1 schema、配置正式 bucket 限定的 R2 Read token，然后按 `V7.1_CLOUDFLARE_STAGING_RUNBOOK.md` 生成/解密验证归档并恢复到隔离资源。
- 备份脚本已提高 R2 完整性门槛：完整归档必须包含每对象 `head-object` JSONL sidecar，且其 key 集合必须与 list inventory 和下载对象集合完全一致；缺少 sidecar 时拒绝封装。R2 HTTP/custom metadata 会在恢复时按 sidecar 应用。
- **当前不具备生产切换条件。**阻塞项：完整生产 D1/R2 备份与恢复、历史生产草稿/版本/媒体关系 hash 核对、V7/FTS5 生产备份路径决定、真实旧/新发布链路切换演练和生产窗口批准。
- 细项待办：V7.1 曾在空 staging DB 重复应用 migration；本轮恢复库含数据后没有重放 migration。已撤回后缓存下线继承此前 V7.1 端到端证据；外部命令行代理读取 RSS/sitemap XML body 返回 403，因此本轮未重新独立核验 XML 内容。真实 iOS Safari 与 Cloudflare 错误网络超时注入未完成。

### 本地构建与状态

- Studio：Node 24.22.2 下 `pnpm typecheck`、`pnpm test`（4 files / 16 tests）、`pnpm build` 通过；随后使用已核验的 staging 专用 config 部署 Studio Worker，当前版本 `d6c7e40f-842d-4dcf-b5da-553497cec427`，未认证 `/api/session` 返回 Access 302。Vite 仍报告约 955 kB 主 bundle（gzip 约 301 kB），本轮未为缩包而拆除编辑器扩展。
- Blog：Node 24.22.2 下 `pnpm check` 48 files、0 errors/warnings/hints；`pnpm build` 通过。Astro Cloudflare adapter 仍提示启用 SESSION KV，staging 配置已有 KV binding。
- 两仓 `git diff --check` 在文档更新后重跑并通过；未提交，无 push。原有 untracked/modified V7 文件与 staging synthetic rows/media 保留。临时测试 Worker、测试 D1/R2 资源也保留，未执行不可逆资源删除。

## V7.3 生产数据保护、Migration 重放与切换准备（2026-11-12）

### 上下文与仓库状态

- 按两个仓库 AGENTS.md 要求恢复上下文，核对 Studio `PROGRESS.md`、`ROADMAP.md`、V7.1 Runbook 和博客 AGENTS.md/README/CONTENT_GUIDE/DESIGN_SYSTEM。Studio `HEAD` 与 `origin/main` 均为 `97afb3391a432bdc17d8fb6068f9b60d8faf7197`；博客均为 `8cc6ad8b5426a95a4ee81aee9cca73a22158c9e3`。两个仓库都有未提交的 V7 改动，均保留。本轮新增隔离 FTS 重建 SQL 与 V7.3 Runbook，增强备份脚本并更新 V7.1 命令；没有 push/deploy/生产 D1/R2 访问。
- 使用只读 Wrangler Pages 元数据确认当前 Pages project 为 `tingwoshuo`，域名为 `tingwoshuo-github-io.pages.dev` 与 `boke.xiaozhangkeji.win`，最近成功生产部署来自博客 `main` / `8cc6ad8`。没有读取 D1/R2 内容或更改 Pages 设置。

### 完成的本地隔离验证

- Blog 的本地 D1 隔离库已有 5 篇文章和 5 个历史版本。重复运行 `pnpm db:v7:test:migrate` 输出 `No migrations to apply!`；运行 Studio 新增的 `scripts/v7-rebuild-search.sql` 后，5 篇有效已发布文章对应 5 条 FTS 记录。中文 `MATCH '何去何从'` 返回 2 条包含该短语的文章；孤儿版本、无有效 published revision 及断链 `article_media` 都为 0。
- 独立 `/tmp/v73-migrate` D1 从 V6 schema 开始，先写入一条合成 draft 和一个 version，再应用 V7 migration。故意让第三条隔离 migration 语法错误，Wrangler 保留前两个成功版本，失败版本不入 `d1_migrations`，失败 SQL 创建的半成品表不存在；修正后重试成功，合成 draft/version 保持各 1 条，`PRAGMA foreign_key_check` 返回空。该演练仅为本地隔离 SQLite，不代表 Cloudflare 生产恢复。
- `pnpm build` 成功。使用 `wrangler pages dev dist` 加本地 DB/KV/R2 binding 后，`/`、`/life/he-qu-he-cong-ne`、`/rss.xml` 和 `/sitemap.xml` 返回 200，未知 slug 返回 404；页面 canonical 与 sitemap URL 保持 `https://tingwoshuo-github-io.pages.dev/`。第一次本地绑定使用 D1 名称而非 UUID，导致本地 Pages mock 指向空 DB 并返回 no-table 500；改为合成 D1 UUID 且同一 persistence 后通过。此为 Pages 本地适配测试，不是实际 Cloudflare Pages staging 验收。
- 现有 `v7:export-legacy` dry run 对 checkout 找到 5 篇 Markdown：5 accepted、0 errors、0 warnings、0 重复 ID、0 媒体引用；hash/slug 清单位于 `/tmp/v73-legacy-dry-run.sql.report.json`。`v7:backup --source-only` 生成 `/tmp/v73-source-snapshot`，报告明确 `complete:false`、未包含 D1/R2。备份脚本 `node --check` 通过。
- 同一个本地 D1 persistence 并行启 Wrangler 查询曾遇 `SQLITE_BUSY`；改为串行查询/操作后通过。Wrangler 4.59.2 本地 Pages runtime 支持日期仅到 2026-01-14，对配置要求的 2026-11-10 自动降级并提示升级 Wrangler；升级并重测前不应把 compatibility date 认证视为完成。

### 生产备份与全量对账状态

- 本轮完全未访问、查询或导出生产 D1/R2。未取得生产文章/草稿/历史版本/媒体元数据/对象清单，因此生产全量 slug、日期、内容 hash、版本与图片引用关系尚无对账结果；本地 5 篇 checkout 内容不是生产完整清单。
- 新增 `scripts/v7-rebuild-search.sql`：从有效发布 revision 重建派生 FTS5 index，禁止直接对生产执行。V7.3 Runbook 记载 REST D1 Export API 的单次 `dump_options.tables` allowlist 用法以排除 FTS 虚拟表，并明确需先授权 schema 检查、Cloudflare D1 Edit/Write 导出权限和可接受的锁库维护窗口。R2 需要生产 bucket 限定 Object Read 权限；Git 内容需要只读仓库快照。任何跨 D1/R2/Git 的一致性快照需要冻结 Studio 写操作。
- 本机此前没有 `age`、AWS CLI、加密备份卷或生产 R2 只读 Profile。未生成生产 D1/R2 备份、manifest hash、age 包或生产恢复验证；D1 export 期间会阻塞其他数据库请求，不能作为无影响的纯只读操作描述。备份脚本现在要求完整 Blog Git bundle、非空 D1 dump，并检测 V7 dump 是否包含文章、版本、媒体关系/导入与 migration 表、排除 FTS 虚拟表；完整模式尚未用生产/FTS filtered export 实际跑过。当前 source-only snapshot 不代表可恢复备份。

### 页面切换与回滚结论

- 当前 Pages 项目拥有项目专属 `pages.dev` 子域。独立 Workers 无法把此 `pages.dev` 子域设为自定义域。优先方案是保留同一个 `tingwoshuo` Pages project、`pages.dev` 和 `boke.xiaozhangkeji.win`，在 Pages 部署 Astro SSR/Pages Functions 并配置 D1/R2/KV bindings。官方文档支持 Astro SSR 部署到 Pages Functions。真实 Cloudflare Pages staging 项目还未部署，因此生产切换步骤仅完成本地 Pages runtime 冒烟，不能称为真实路由切换演练。
- 同项目切换保留当前 canonical、RSS、Sitemap host 和历史 slug；若另起独立 Worker，须使用 `workers.dev` 或自有 Zone 的域名，旧 Pages 地址需继续服务或单独配置重定向，不能无缝移交 `pages.dev`。
- Pages deployment rollback 只切换到先前成功部署，不回滚 D1/R2。切换期间/回滚决策期冻结发布；若退回静态 Git 版本，须先将切换后新增/更新/撤回的 D1 内容按 slug 和 hash 补偿回旧 Git 发布源，再解冻，不能自动双写或假定旧静态构建会读 D1。
- 所有切换手顺、恢复顺序、未验证项和审批边界集中记录于 `V7.3_CUTOVER_RUNBOOK.md`。没有改生产 URL 配置或关闭旧 Git 发布链路。

### 验证命令和上线判定

- 本轮：Studio backup script `node --check` 通过；Blog `pnpm build` 通过；legacy dry run、Migration 重放/中断恢复、FTS 重建、Pages local SSR routes 均有上述执行结果。未重新部署 Worker/Pages。
- **目前不具备生产切换条件。**阻塞：生产备份单独授权并实际完成；全量历史/草稿/版本/R2/引用 hash 对账；age 加密与隔离恢复成功；升级 Wrangler 后兼容日期验证；Cloudflare Pages 独立 staging SSR 部署、bindings、Access/cache/SEO 验收；站主单独授权生产 Pages deploy 与冻结窗口。

## V7.4 生产备份准备与真实 Pages Staging 预演（2026-11-12）

### 独立 Cloudflare Pages Staging

- 使用 Wrangler 4.160.1 创建并直接上传独立 Pages 项目 `tingwoshuo-blog-v74-staging`；Pages project list 显示 Git Provider `No`，项目域名 `https://tingwoshuo-blog-v74-staging.pages.dev/`。最新部署 ID `00a790c4-6aa0-4563-aa73-b8d72e4bb194`，预览 URL `https://00a790c4.tingwoshuo-blog-v74-staging.pages.dev/`；其生产分支名为 `v74-staging`。这是隔离 Staging 项目，Cloudflare 将其显示为该独立项目的 Production 环境，不代表正式项目 production。
- 从 Pages 项目下载的实际 runtime 配置确认：`ENVIRONMENT=staging`；D1 `tingwoshuo-v72-restore-test` / `99ebfa43-215c-4f00-b25d-74da66e31a14`；R2 `tingwoshuo-v72-restored-media`；KV `4c2c05addb004898a36e1723f388e116`。三者均为既有隔离测试/恢复资源，无生产 ID、正式 Bucket 或 KV。D1/R2 fixture 是 V7.2 合成历史恢复夹具。
- Astro SSR/Pages Functions 在 Cloudflare 上成功编译、部署并运行。`SESSION` KV 绑定可用，路由无 session runtime error。`astro.config.mjs` 使用 `imageService: 'passthrough'`，恢复图片实际读取成功，不调用 Worker Sharp 图像优化。Pages staging 没有 Studio 编辑 API；匿名 POST `/api/v7/articles` 返回 404。
- 页面 `/`、`/life`、`/tech`、`/search`、`/tech/v72-restore-fixture` 均返回 200，旧路径 `/tech/v72-restore-fixture` 可读；缺失路径 HTTP 404。正文图与封面均返回 `image/webp`，下载对象 SHA-256 为 `79ea3317780c530df4b4f46f88fa02fe28094f255a4c01d90f8a3d08c92e76d3`，与既有恢复演练记录匹配；正文图注和 alt 文本存在。
- 中文搜索标题词命中唯一文章，Chrome 实测结果“找到 1 条结果”，关键词以 `<mark>` 高亮。RSS/Sitemap HTTP 200 且包含恢复夹具旧 slug；Canonical、OG URL、robots Sitemap 均使用 Staging origin；`X-Robots-Tag: noindex, nofollow`、meta robots noindex/nofollow 和 `robots.txt Disallow: /` 均生效。
- SEO 验收时发现文章 `og:type` 错误沿用 `website`，已修改 `BaseLayout.astro` 支持 `ogType`，`ArticleLayout.astro` 传 `article`。重新构建并部署后，文章 `og:type=article`、BlogPosting JSON-LD、标题和描述正确，根页面仍为 `website`。
- 使用 Chrome + Playwright 在 320、360、375、390、430、768、1024、1440px 及浅/深主题检查首页、闲聊、技术、搜索、超长中文标题和带封面/正文图的文章，共 80 组合；无横向溢出、断图、Staging canonical 错误或 5xx。真实 iOS Safari 尚未测。
- Wrangler 4.160.1 用于本次部署/runtime；兼容日期采用 `2026-11-11`（UTC 当天）。`2026-11-12` 会被 CLI 判为未来日期并拒绝。Staging 接受的 `2026-11-11` 未触发兼容日期降级。
- 独立项目 Direct Upload，不连接 GitHub。正式 Pages 项目仍是 `main` / `8cc6ad8`，只读状态显示最新生产部署 ID `9aa590c5-0aa1-48d1-8327-b55bd41f7707`、约 4 小时前，正式主页仍返回原静态页面。未对正式项目发起部署、设置修改、域名/route 切换或生产资源查询。

### 生产备份与对账

- 生产 D1/R2 本轮仍未访问、查询或导出，未生成生产备份、加密归档或全量差异报告。现有 staging restore D1/R2 被实际 Pages SSR 使用并成功提供合成文章和图片，但这不等于生产备份或生产数据对账。
- V7.3 备份流程与脚本保留：D1 Export API 按审核后的基础表 allowlist 排除 `article_search` FTS5，R2 下载对象和元数据、Blog Git bundle、SHA-256 manifest、age 加密和隔离恢复说明记录在 `V7.3_CUTOVER_RUNBOOK.md`。仍需站主单独授权生产 D1 Export（含 D1 Edit/Write 权限及导出锁库维护窗口）和正式 bucket 仅对象读取权限；当前生产数据没有备份/对账证据。
- 两仓 `pnpm typecheck`、`pnpm test`（4 files / 16 tests）、`pnpm build`、博客 `pnpm check`（48 files，0 errors/warnings/hints）、博客 `pnpm build` 均通过；`git diff --check` 在本轮文档修改完成后复跑。Studio build 仍有 955.18 kB 主 JS bundle 警告。
- **不具备正式切换条件。**剩余阻塞：生产备份单独授权并完整恢复；生产 Git/D1 草稿/版本/R2/引用 hash 全量对账无差异；真实 iOS Safari 补验；生产 Pages 同项目切换与发布冻结另行批准。正式 Pages、D1/R2、Access、GitHub 旧发布链路均保持原样。

## V7.5 生产备份准备与全量迁移验收（2026-11-12）

### 上下文与仓库状态

- 恢复并检查 Studio/博客 AGENTS、Studio PROGRESS/ROADMAP、V7.3 Cutover Runbook、博客 README/Content Guide/Design System。Studio `main` HEAD/origin 为 `97afb3391a432bdc17d8fb6068f9b60d8faf7197`，博客 `main` HEAD/origin 为 `8cc6ad8b5426a95a4ee81aee9cca73a22158c9e3`。两个工作区均已有未提交的 V7 改动，本轮保留；未暂存、提交、推送或部署。
- 两仓差异包括既有功能代码、迁移与测试、隔离 Wrangler 样例、文档；Studio `tsconfig.app.tsbuildinfo` 为已跟踪构建缓存变更，开始前即已修改，需提交前人工审查，不应作为功能文件提交。没有新增生产导出、R2 对象、密钥、age identity 或生成图片进入工作区。

### 生产备份前检查（未访问生产数据）

- 本机默认 Node 20.13.1；Node 24.22.2 明确加入 `PATH` 后可运行 Wrangler 4.160.1。Studio lockfile 本地 Wrangler 为 4.159.0；两者都要求 Node 22.12.0+。`jq` 可用；`age`、`age-keygen`、AWS CLI 不存在；`~/.config/age` 与两个 `V7_AGE_*` 变量未配置；`/Volumes/EncryptedBackups` 未挂载。用户目录文件系统有约 212 GiB 可用空间，但不是经确认的加密备份盘。
- 配置文件本地声明的目标是 D1 `tingwoshuo-studio-production`、R2 `tingwoshuo-studio-private`。未调用生产 D1/R2 API、未查询生产数据库/对象，也未获取生产文章、草稿、版本、Slug、hash 或引用关系。
- 生产操作计划见 `V7.3_CUTOVER_RUNBOOK.md` 的 V7.5 addendum：D1 仅用独立授权的 Cloudflare API **D1 Edit** token 调用 Export，先经授权检查 schema 再把实际应用基础表写入 `dump_options.tables`；排除 `article_search` FTS5，不删除生产虚拟表。D1 Export 会阻塞该库其他请求，需维护窗口与 Studio 写入冻结。R2 使用限定正式 bucket 的 **Object Read only** S3 权限（List/Head/Get，无写删）；Git 仓库只读快照。失败即停止并保持写冻结，恢复只写入新建隔离资源。
- 正式备份授权清单尚未由用户提供；没有声称生产备份完成，也没有申请生产切流授权。

### Staging/隔离数据与页面验收

- Pages Staging 绑定核查仍指向隔离 D1 `tingwoshuo-v72-restore-test`、R2 `tingwoshuo-v72-restored-media` 和独立 KV。使用 Wrangler 4.160.1 从 Staging D1 显式导出 `drafts`、`draft_versions`、`media`、`publish_jobs`、`rate_limits`、`articles`、`article_versions`、`article_media`、`legacy_imports`、`d1_migrations`；SQL 约 29 KiB，含基础表结构/数据，无 FTS 虚拟表语句。操作没有触及生产。
- SQL 恢复到仓库外新建本地 D1 persistence：6 articles、6 revisions、1 media row、2 article_media refs；article/version/media 标识、slug/hash 的规范化源/恢复 SHA-256 汇总均为 `004e3055ce6c024d861607ce40c56ea6d0977481a74536359539250c00ff4afd`；`PRAGMA foreign_key_check` 为空。按匹配迁移重新创建 FTS5 和触发器后，重建 6 条发布索引；中文 `MATCH '何去何从'` 命中 2 篇。含数据的 Staging D1 再次 `migrations list` 和 `migrations apply` 均显示 `No migrations to apply!`。
- Pages Staging HTTP 回归：首页、闲聊、技术、搜索、文章、RSS、Sitemap、robots 为 200；不存在文章 404；合成 slug 在 RSS/Sitemap 可见；博客未开放 Studio 写 API。线上图片返回 874 bytes，SHA-256 与 D1 媒体记录一致：`79ea3317780c530df4b4f46f88fa02fe28094f255a4c01d90f8a3d08c92e76d3`。
- Chrome/Playwright 80 个组合（320/360/375/390/430/768/1024/1440 px × light/dark × 首页、两栏目、搜索、合成文章）均无横向溢出、破图或 5xx。搜索结果“找到 1 条”，高亮 1 处；robots/RSS/Sitemap 为 200，缺失路由 404。iOS Safari 未实机验证。
- 本地 Worker/编辑器的 Playwright 网络故障演练中，合成草稿 create 请求分别立即断连、延迟 2.5 秒后模拟超时断开；界面显示“修改已保留在此设备”，完整标题/正文同时保存在 localStorage 和 IndexedDB。V7.2 发布事务/媒体上传失败测试继续作为之前证据。本次没有模拟 Cloudflare 生产故障；Studio fetch 没有显式 AbortController 超时，底层连接永久挂起时仍可能一直显示保存中。
- 页面路由预演维持 V7.4 独立 Pages Staging Direct Upload；未修改生产 Pages `tingwoshuo`。切换仍优先保留同一 Pages 项目与 `pages.dev`/自定义域，SSR 放入 Pages Functions。独立 Staging 不能验证生产 Pages project 内的同域切换；旧静态部署回滚不回滚 D1/R2，新产生文章须冻结写入、从 D1 导出并逐 slug/hash 补偿到 Git 后才能重新开放旧链路。

### 提交审查与下一步

- 建议经人工审阅后分别提交代码/迁移、测试、运维文档；排除 `tsconfig.app.tsbuildinfo`、生产导出和对象、密钥、`.dev.vars`、age identity。工作区未暂存/提交/推送；本轮没有清空或恢复已有改动。
- 本阶段确认的 blockers：`age`/AWS CLI/加密介质缺失；未获生产数据读取或导出授权；生产 D1 schema 未核验；没有完整生产 D1/R2/Git 备份与隔离恢复；全量文章/草稿/版本/媒体关系/hash 对账未做；完整 R2 bucket 下载恢复未在本轮重跑；真实同项目 Pages 切换及 iOS Safari 未验证。
- 验证结果：Studio Node 24.22.2 下 `pnpm typecheck` 通过、`pnpm test` 4 files/16 tests 全过、`pnpm build` 成功；Vite 仍提示 955.18 kB 主 chunk 超过 500 kB。博客 Node 24.22.2 下 `pnpm check` 48 files、0 errors/warnings/hints，`pnpm build` 成功；Astro 提示 SESSION KV 绑定说明，无 Invalid binding 错误。两仓 `git diff --check` 通过。
- **上线判定：不具备生产切换条件；也未完成申请切流所需的完整数据证据。**下一项是安装/准备备份工具与专用加密介质，然后向站主提交精确生产 schema 核查和 D1 Export / R2 只读操作授权清单。保持旧 Pages + Git 发布链路。
## V7.0 正式上线与仓库整理（2026-11-12）

本节为目前的项目方向，覆盖此前 V7.5 生产备份准备工作；不代表生产切换已执行。

- 用户要求停止重复的备份准备阶段，将重点转到 V7 正式上线和两仓清理。保留所有既有 V7 业务代码、迁移、测试、运行手册和文章；不清空工作区，不执行推送或部署。
- 生产资源只读元数据核对：D1 为 `tingwoshuo-studio-production`（`6e67b37c-3041-4fd7-b832-eb0fffe2e9c7`），R2 为 `tingwoshuo-studio-private`，Studio Worker 为 `tingwoshuo-studio`，博客 Pages 项目为 `tingwoshuo`，正式地址仍为 `https://tingwoshuo-github-io.pages.dev/`。博客 Pages 已连接 Git Provider；推送 main 可能触发正式部署。
- 在用户允许的只读 schema 核验中，生产 D1 只有旧版 `drafts`、`draft_versions`、`media`、`publish_jobs`、`rate_limits` 与 `d1_migrations` 及其索引；没有 V7 `articles`、`article_versions`、`article_media`、`legacy_imports` 或 FTS 表。此查询没有读取文章行，未写数据库。生产旧表可能包含正式草稿、版本和媒体元数据，必须先取得可恢复备份并另行确认后才能迁移。
- 正式 Pages 当前没有 D1、R2、KV bindings；仍是 GitHub 集成的静态生产部署。Studio 本地正式配置默认 GitHub 内容后端；生产 Worker 的实际绑定/运行变量未完全核实。OAuth 当前缺少 Cloudflare Access Apps Read 范围，因此不能确认生产 Access 应用/策略状态；未修改策略。
- 未访问或导出生产 D1/R2 内容；没有生产备份、数据迁移、历史文章导入、发布目标切换、生产部署或 Git Push。生产备份仍缺 `age`、AWS CLI、专用加密存储和 R2 限定只读凭据；V7.3 Runbook 记载了现有操作命令和恢复流程，无需再开发备份框架。
- 审查结论：保留 Studio V7 migration `0002_v7_articles.sql`、D1/R2 文章 API、备份与 legacy 导出脚本、FTS 重建 SQL、媒体测试、迁移专用配置、staging 示例和 V7 运维手册；保留博客 Astro SSR/D1 读取、搜索、RSS、Sitemap、SEO、媒体路由、Markdown/MDX 渲染、local Wrangler 隔离配置和渲染 smoke 脚本。均有代码、package 命令或文档引用。
- 清理仅针对生成物与忽略规则：Studio 已跟踪的 `tsconfig.app.tsbuildinfo` 是 TypeScript 构建缓存，停止跟踪但保留本地副本；两仓 `.gitignore` 增加构建缓存、本地 DB、加密归档、导出清单、密钥文件和本地凭据目录规则。忽略正式 migration SQL 不在规则内。
- 当前生产切换阻塞仍是：生产数据副本尚未授权/完成并恢复验证；全量 Git/D1/R2 内容和引用对账未完成；生产 Pages 无 SSR 数据绑定；Studio D1 发布运行变量与生产 Access 状态未完整核对。依次处理这些数据和资源门槛并取得针对性确认前，不具备正式切换条件。
- 支持 Node 24.22.2 下本轮完整验证：Studio `pnpm typecheck` 通过，`pnpm test` 4 个文件/16 项全通过，`pnpm build` 成功；仍有 955.18 kB 主 JS chunk 超过 500 kB 的 Vite 警告。博客 `pnpm check` 48 个文件、0 errors/warnings/hints，`pnpm build` Astro Cloudflare SSR 成功；构建输出提示 SESSION KV 绑定说明，但没有 Invalid binding 错误。两仓 `git diff --check` 通过。默认 Node 20.13.1 不受 Vite 支持，以上结果使用已安装的 Node 24.22.2 取得。
- 本轮检查到博客 Pages 生产项目仍有 GitHub Provider；生产推送 main 有自动部署风险。博客正式 Pages 当前无 D1/R2/KV binding。Cloudflare OAuth 不能读取 Access Apps/Policies，因此 Access 状态仍未核实。未推送、部署或修改任何生产资源。
- 目前仅移除被 Git 跟踪的 Studio `tsconfig.app.tsbuildinfo` 构建缓存跟踪状态，保留本机文件；两仓忽略规则已补入本地 DB/密钥/归档/导出清单/TS 缓存模式。生成 dist 与 Astro 缓存可在验证结束后删除；隔离 `.wrangler` 数据保留。所有 V7 迁移、业务代码、测试、备份/迁移脚本和必要运行手册继续保留。
- 工作方向直接进入 V7 本地整理、测试、可审阅提交和明确的生产切换授权，不创建 V7.6 等额外阶段。本轮是否提交及对应 commit hash 以本节后续实际记录为准。
