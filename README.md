# GitMD

Git 驱动的团队内部文档平台：从 CodeHub 仓库拉取 Markdown 渲染展示，webhook 感知变更，在线编辑直接推回远端仓库。**git 仓库是唯一数据源。**

详细设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 功能

- 文档渲染：GFM（表格/任务列表）、代码高亮、数学公式（KaTeX）、mermaid 图表、frontmatter、md 互链与相对图片自动重写
- 双模式编辑器：CodeMirror 源码（+实时预览）/ Milkdown 所见即所得，frontmatter 独立面板
- 编辑即提交：保存 → commit（author=当前用户，committer=bot）→ push，冲突自动 rebase 重试
- 变更感知：CodeHub webhook（token 验签）+ 定时轮询兜底
- 文件管理：新建/删除/重命名/移动，图片粘贴上传存入 `assets/` 随仓库推送
- 全文搜索（中文优化）、单文件版本历史与 diff 视图
- 本地账号密码登录，admin/member 两级角色

## 快速体验（无需真实仓库）

```bash
npm install
bash scripts/demo.sh        # 创建 /tmp 下的模拟远端并启动 dev server
# 打开 http://localhost:3000 ，账号 admin / admin123
```

## 本地开发（对接真实 CodeHub）

```bash
cp .env.example .env        # 填 REPO_URL / AUTH_SECRET / WEBHOOK_SECRET 等
npm install
npm run dev                 # instrumentation 会自动克隆仓库并启动轮询
```

生产模式：`npm run build && npm start`（注意 `output: standalone` 下正式部署用 `node .next/standalone/server.js`，Dockerfile 已处理）。

## Docker 部署

```bash
# 准备 deploy key（CodeHub 仓库 → 设置 → 部署密钥，授予读写权限）
mkdir -p keys && cp ~/.ssh/codehub_deploy_key keys/deploy_key
cp .env.example .env        # 编辑配置
docker compose up -d --build
```

数据（SQLite + 仓库克隆）都在 `gitmd-data` 卷中，重建容器不丢数据。

### CodeHub webhook 配置

仓库 → 设置 → Webhooks → 添加：

- URL：`http://<平台地址>/api/webhook?token=<WEBHOOK_SECRET>`
- 事件：Push

webhook 丢失时由 `POLL_INTERVAL_MS` 轮询兜底（默认 10 分钟）。

## 环境变量

见 [.env.example](.env.example)。

## 冲突行为说明

- 浏览态同步：`fetch + reset --hard origin/main`，远端永远是权威
- 编辑保存：内容哈希乐观锁——打开文档后若被他人修改，保存返回 409，前端提示选择覆盖或放弃
- push 被拒（non-fast-forward）：自动 `fetch + rebase` 重试；rebase 冲突则回滚本地提交并返回 409
- 所有 git 操作经仓库级串行队列执行，同步与编辑不会交错

## 技术栈

Next.js 16 (App Router, standalone) · simple-git · better-sqlite3 (FTS5) · unified/remark/rehype · Milkdown Crepe · CodeMirror 6 · mermaid · KaTeX
