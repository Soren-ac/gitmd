# GitMD

Git 驱动的团队内部文档平台：从 CodeHub 仓库拉取 Markdown 渲染展示，webhook 感知变更，在线编辑直接推回远端仓库。**Git 仓库是唯一数据源**——平台本身不拥有文档内容，克隆仓库即拥有整个知识库（文档、图片、批注）。

架构设计与关键权衡见 [docs/DESIGN.md](docs/DESIGN.md)。

## 功能特性

**文档渲染**

- GFM（表格 / 任务列表 / 删除线）、代码高亮、KaTeX 数学公式、Mermaid 图表
- Frontmatter 解析（title / description / tags），Markdown 互链与相对图片路径自动重写
- 右侧目录、标题锚点、代码块复制按钮

**编辑**

- 双模式编辑器：CodeMirror 源码模式（实时预览）/ Milkdown Crepe 所见即所得，随时切换
- 编辑即提交：保存 → commit（author = 当前用户，committer = bot）→ push；push 被拒自动 rebase 重试
- 内容哈希乐观锁：编辑期间文档被他人修改时提示冲突，由用户决定覆盖或放弃
- 未保存内容离开时拦截（关闭页面 / 站内跳转均有提示）
- 图片粘贴、拖拽、WYSIWYG 内上传，存入仓库 `assets/` 随提交推送
- 文件管理：新建 / 删除 / 重命名 / 移动

**批注**

- 选中正文任意文字发表批注；同一段文字可叠加多条，按时间平铺展示
- 锚点随文档演化自动重定位：精确匹配 → 基于 base 版本的 diff 平移 → 模糊匹配
- 原文被删除或大改的批注不会丢失，集中收在页面右下角的「失效批注」面板
- 批注以 YAML sidecar 形式存放在仓库 `.gitmd/annotations/` 内，随同步分发，可直接在 Git 侧审阅
- 支持追加评论、标记解决 / 重新打开；仅本人可删除自己的批注

**搜索与历史**

- SQLite FTS5 全文搜索（unicode61 分词，中文可用），同步时按变更文件增量更新索引
- 单文件版本历史、任意两版本 diff 对比视图

**账号与权限**

- 本地账号密码登录（scrypt 哈希 + HMAC 签名 httpOnly cookie，零外部依赖）
- admin / member 两级角色；admin 管理用户，用户可配置个人 Git 提交身份

## 快速体验

无需真实仓库，脚本会在 `/tmp` 下创建模拟远端并启动开发服务器：

```bash
npm install
bash scripts/demo.sh
# 打开 http://localhost:3000 ，账号 admin / admin123
```

## 本地开发（对接真实 CodeHub）

```bash
cp .env.example .env        # 填写 REPO_URL / AUTH_SECRET / WEBHOOK_SECRET 等
npm install
npm run dev                 # instrumentation 启动钩子自动克隆仓库并启动轮询
```

生产模式：`npm run build && npm start`。注意 `output: standalone` 配置下正式部署应使用 `node .next/standalone/server.js`（Dockerfile 已处理）。

## Docker 部署

```bash
# 准备 deploy key（CodeHub 仓库 → 设置 → 部署密钥，授予读写权限）
mkdir -p keys && cp ~/.ssh/codehub_deploy_key keys/deploy_key
cp .env.example .env        # 编辑配置
docker compose up -d --build
```

SQLite 数据库与仓库克隆都在 `gitmd-data` 卷中，重建容器不丢数据。

### CodeHub webhook 配置

仓库 → 设置 → Webhooks → 添加：

- URL：`http://<平台地址>/api/webhook?token=<WEBHOOK_SECRET>`
- 事件：Push

webhook 丢失时由 `POLL_INTERVAL_MS` 轮询兜底（默认 10 分钟）。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `REPO_URL` | 是 | CodeHub 仓库地址，推荐 SSH（如 `git@codehub.example.com:team/docs.git`） |
| `AUTH_SECRET` | 是 | 会话签名密钥，`openssl rand -hex 32` 生成 |
| `WEBHOOK_SECRET` | 是 | webhook 验签 token，配在 CodeHub webhook URL 的 `?token=` 上 |
| `REPO_BRANCH` | 否 | 分支，默认 `main` |
| `GIT_SSH_KEY` | 否 | SSH deploy key 在容器内的路径（REPO_URL 为 SSH 地址时必填） |
| `POLL_INTERVAL_MS` | 否 | 轮询兜底间隔（毫秒），默认 `600000` |
| `DATA_DIR` | 否 | 数据目录（SQLite + 仓库克隆），默认 `./data`，Docker 中为 `/data` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 否 | 初始管理员账号，仅首次播种数据库时生效（默认 `admin` / `admin123`，务必修改） |
| `GIT_BOT_NAME` / `GIT_BOT_EMAIL` | 否 | committer 身份（author 始终是实际操作用户），默认 `gitmd-bot <gitmd@local>` |
| `PORT` | 否 | 服务端口，默认 `3000` |

完整注释版见 [.env.example](.env.example)。

## 冲突与一致性

- 浏览态同步：`fetch + reset --hard origin/main`，远端永远是权威
- 编辑保存：内容哈希乐观锁——打开文档后若被他人修改，保存返回 409，前端提示覆盖或放弃
- push 被拒（non-fast-forward）：自动 `fetch + rebase` 重试；rebase 冲突则回滚本地提交并返回 409
- 所有 Git 操作经仓库级串行队列（RepoQueue）执行，同步与编辑永不交错

## 项目结构

```
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (main)/             # 主站页面（middleware 全站鉴权）
│   │   │   ├── docs/           #   阅读页
│   │   │   ├── edit/           #   编辑器
│   │   │   ├── history/        #   版本历史与 diff
│   │   │   ├── search/         #   全文搜索
│   │   │   ├── admin/          #   用户管理
│   │   │   └── settings/       #   个人设置
│   │   ├── api/                # REST API 路由
│   │   └── login/              # 登录页
│   ├── components/
│   │   ├── layout/             # 应用骨架：导航 / 侧栏 / 命令面板 / 最近访问
│   │   ├── docs/               # 阅读页组件：目录 / Mermaid / 图片 / 历史
│   │   ├── editor/             # 双模式编辑器（CodeMirror + Milkdown）
│   │   ├── annotations/        # 批注层（高亮、气泡、失效面板）
│   │   ├── admin/              # 管理面板
│   │   ├── settings/           # 个人设置表单
│   │   └── common/             # Toast / Dialog / 复制按钮
│   ├── lib/
│   │   ├── core/               # 配置 / SQLite / 启动引导
│   │   ├── git/                # Git 服务（RepoQueue 串行队列、写操作、同步）
│   │   ├── content/            # 文档读写 / 文件树 / 路径安全
│   │   ├── markdown/           # 渲染管线（remark/rehype）与 frontmatter
│   │   ├── annotations/        # 批注锚点定位与 sidecar 读写
│   │   ├── search/             # FTS5 索引（增量 + 全量重建）
│   │   └── auth/               # 会话 / 密码（scrypt）
│   └── instrumentation.ts      # 启动钩子：初始克隆 + 轮询兜底
├── docs/DESIGN.md              # 详细设计文档
├── scripts/demo.sh             # 本地演示环境一键脚本
├── Dockerfile                  # 单镜像生产构建（node + git + openssh）
└── docker-compose.yml
```

## 安全说明

- 会话：httpOnly + SameSite=Lax cookie，HMAC-SHA256 签名，7 天过期
- 密码：node:crypto scrypt（16B 随机盐），timingSafeEqual 比对
- middleware 全站鉴权，仅放行 `/login`、`/api/auth/*`、`/api/webhook`；图片等仓库资源接口同样要求登录
- 所有路径参数 normalize 后校验必须落在仓库根内，防路径穿越
- webhook 验签失败返回 401，不触发任何操作
- Git 凭据使用 SSH deploy key，挂载进容器，不出现在代码与日志中

## 技术栈

Next.js 16（App Router / standalone / Turbopack）· React 19 · simple-git · better-sqlite3（FTS5）· unified / remark / rehype · Milkdown Crepe · CodeMirror 6 · Mermaid · KaTeX
