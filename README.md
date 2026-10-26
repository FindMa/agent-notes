# Agent 笔记

一个可持续更新的 GitHub Pages 博客。第一期发布 PI Agent Harness 的 12 节源码伴读和互动架构总览。

- 博客：https://findma.github.io/agent-notes/
- PI 源码伴读：https://findma.github.io/agent-notes/posts/pi-harness/
- 互动总览：https://findma.github.io/agent-notes/posts/pi-harness/pi-overview.html
- 仓库：https://github.com/FindMa/agent-notes

## 本地预览

需要 Node.js 20 或以上及 Python 3：

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm run preview
```

打开 `http://127.0.0.1:8790/`。网页发布目录是 `docs/`；GitHub Pages 使用 `main` 分支的 `/docs`。

## 更新 PI 系列

1. 修改 `content/pi-harness/chapters/` 内对应 Markdown。
2. 修改互动总览时编辑 `scripts/overview.mjs` 中的模块数据。
3. 运行 `npm run build` 和 `npm run check`。
4. 提交源文件和更新后的 `docs/`，推送 main，GitHub Pages 自动发布。

## 新增普通博客

在 `content/articles/` 创建 `my-article.md`，然后向 `content/posts.json` 加入一项：

```json
{
  "slug": "my-article",
  "title": "文章标题",
  "description": "首页显示的一句话介绍。",
  "date": "2026-10-26",
  "kind": "article",
  "tags": ["Agent 工程"]
}
```

`slug` 使用小写英文、数字和短横线，Markdown 文件名与它一致。文章正文以一级标题开头即可。运行构建会生成独立文章页，并把它加入首页文章列表。

```bash
npm run build
npm run check
git add content scripts docs blog.config.json
git commit -m "docs: publish new article"
git push
```

## 项目结构

- `content/`：文章 Markdown 和文章列表。
- `scripts/build.mjs`：生成博客首页、普通文章和 PI 系列。
- `scripts/build-reader.mjs`：PI 系列阅读页。
- `scripts/overview.mjs`：PI 互动架构图。
- `docs/`：可直接由 GitHub Pages 托管的静态文件。
- `blog.config.json`：网站名称、仓库地址与正式访问地址。

页面不需要服务端、不读取 API Key，没有第三方统计脚本。PI 源码引用固定到 `eb326d265ae0b88489a6d10319307780df827cdf`；代码片段的上游版权与 MIT 许可见 `NOTICE`。学习笔记区分源码事实、示意例子和待执行练习，不把静态阅读当作模型实测或生产验收。
