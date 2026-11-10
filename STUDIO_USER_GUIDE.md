# Studio 使用指南

## 登录与工作台

部署后打开单独的 `workers.dev` 地址，Cloudflare Access 会先要求使用授权身份登录。工作台把私人草稿与 GitHub 已有文章列在一起。新建文章会先保存到 D1，不会立即出现在博客。

## 新建和编辑

1. 选择“新建文章”，填写标题、摘要、栏目、标签和日期。
2. 可视化模式适合常见 Markdown；Markdown 模式支持精确编辑。编辑器支持 H1–H3、粗斜体、下划线、删除线、行内代码、语义文字色、背景强调、引用、列表、任务列表、表格、链接、图像、分隔线、代码块、撤销/重做。
3. 输入 `/` 在段落开头打开插入菜单。支持粘贴或拖入图片。图片在本机浏览器转 WebP 后上传到私有 R2，Alt 和图注会写入资源记录；图注显示为图片下方的斜体段落。
4. 停止输入约 1.2 秒后自动保存到 D1。顶部显示保存状态；掉线时保留 IndexedDB 离线副本。恢复离线副本或恢复历史版本前会确认。
5. 已有文章可从文章库打开。Slug 与栏目固定以保护永久 URL。含 MDX/JSX、HTML 或代码围栏额外元数据的文章会使用源码模式，避免可视化转换丢失结构。
6. “预览”用于安全预览普通 Markdown；复杂 MDX 需在博客预览环境核对。

## 版本和图片

文章属性可查看 D1 revision 历史并恢复某一版本。恢复会生成新的 revision，不删除旧版本。媒体库可看私有图片与删除资源；删除前请确认草稿不再引用它。当前未实现自动“未使用图片”判断和图片重命名。

## 发布文章

1. 确保草稿保存成功。
2. 点击“准备发布”，核对标题、栏目、Slug、目标 Markdown/MDX 路径、图片列表和基分支。
3. 明确确认后，Worker 创建新 GitHub 分支和 Pull Request。
4. 在 GitHub 检查并合并 PR。合并后 Cloudflare Pages 自动构建博客。

“PR 已创建”只表示已提交审核，不代表 PR 已合并或网站已上线。当前 Studio 不跟踪 Cloudflare Pages 部署结果。网站设置仍由博客 Git 配置管理，Studio 不会伪装成在线修改设置。

## 备份与恢复

定期导出 D1：`wrangler d1 export tingwoshuo-studio --remote --output ./studio-backup.sql --config wrangler.toml`；R2 可通过 Cloudflare Dashboard 的 bucket 下载对象，或使用 S3 兼容工具做完整同步。将 SQL 和对象备份存放在加密的私人位置。恢复前创建新库/桶并先在隔离的 preview Worker 演练，再导入 SQL 和对象；勿把备份提交到 Git。
