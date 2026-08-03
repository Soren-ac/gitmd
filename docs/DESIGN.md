# GitMD 设计文档

Git-backed 的内部文档平台：从 CodeHub 仓库拉取 Markdown 渲染展示，支持在线编辑并直接推回远端仓库。git 仓库是唯一数据源，平台本身不拥有文档内容。

## 1. 总体架构

```
┌─────────────────────────────────────────────────┐
│  Next.js (App Router, Node 运行时, standalone)    │
│                                                  │
│  页面层  /docs/*  /edit/*  /history/*  /admin     │
│  ────────────────────────────────────────────   │
│  API 层  /api/webhook  /api/docs  /api/assets     │
│          /api/search   /api/history /api/admin/*  │
│  ────────────────────────────────────────────   │
│  核心层  GitService (simple-git)                  │
│          RepoQueue (仓库级串行队列)                │
│          MarkdownPipeline (remark/rehype)         │
│          SearchIndexer (SQLite FTS5)              │
│  ────────────────────────────────────────────   │
│  存储   SQLite (用户/搜索索引/同步状态)            │
│         + 本地 git clone (DATA_DIR/repo)          │
└──────────────┬──────────────────────▲────────────┘
        commit/push│                  │ webhook + 定时轮询
                   ▼                  │
            内部 CodeHub 仓库 (main 分支)
```

## 2. 关键决策（来自需求讨论）

| 决策点 | 结论 |
|---|---|
| 技术栈 | Next.js 全栈（App Router），Node 运行时自托管，非 serverless |
| 部署 | 单 Docker 镜像自部署，挂载数据卷 |
| 规模 | 单仓库，团队内部使用，全员登录 |
| git 平台 | 华为 CodeHub（内网），SSH deploy key 认证 |
| 提交策略 | 编辑直推 main，committer=bot，author=当前用户 |
| 编辑器 | 双模式：Milkdown WYSIWYG + CodeMirror 源码切换 |
| 认证 | Auth 方案：本地账号密码（scrypt + HMAC 签名 cookie 会话，零外部依赖） |
| 权限 | 两级角色：admin（管用户/配置）、member（浏览+编辑） |
| 数据库 | SQLite（better-sqlite3），只存用户、FTS 索引、同步状态 |
| 冲突策略 | 内容哈希乐观锁 + push 失败后 fetch+rebase 自动重试，仍冲突则 409 返回前端 |
| 同步 | webhook（验签）+ 定时轮询兜底（默认 10 分钟） |

## 3. 数据流

### 3.1 读路径（同步）

```
webhook / 轮询 / 手动触发
  → 验签（token 比对，适配 CodeHub）
  → 入 RepoQueue（串行）
  → git fetch origin
  → 本地 HEAD != origin/branch ?
      → git reset --hard origin/branch   (远端权威，永不冲突)
      → 收集变更文件清单
      → 失效相关渲染缓存
      → 重建受影响文档的 FTS 索引
  → 更新 sync_state
```

### 3.2 写路径（编辑保存）

```
前端保存 (content + baseHash)
  → 服务端校验会话
  → 计算当前文件哈希，与 baseHash 不一致 → 409 {conflict: true, current, base}
  → 入 RepoQueue（串行，与同步互斥）
  → 二次校验哈希（队列等待期间可能变化）
  → 写文件 → git add → git commit
       committer = "gitmd-bot <gitmd@local>"
       author    = "<用户名> <用户名@gitmd.local>"
  → git push
      失败 → fetch + rebase origin/branch → 再 push（最多重试 2 次）
      rebase 冲突 → rebase --abort → reset --hard origin/branch → 返回 409
  → 更新该文件 FTS 索引
```

### 3.3 为什么需要 RepoQueue

`reset --hard` 会把本地"已 commit 未 push"的提交冲掉。把同步和编辑都放进同一个 per-repo 串行队列，两类操作永不相交，这个窗口被彻底消除。单实例部署用内存 promise 链即可，无需外部队列。

## 4. 数据库表结构（SQLite）

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- scrypt: salt:hash (hex)
  role          TEXT NOT NULL DEFAULT 'member',  -- admin | member
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE doc_fts USING fts5(
  path UNINDEXED,
  title,
  content,
  tokenize = 'unicode61'
);

CREATE TABLE sync_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  last_head    TEXT,
  last_sync_at TEXT,
  last_status  TEXT,                    -- ok | error
  last_error   TEXT
);
```

首次启动用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 环境变量播种 admin 账号。

## 5. API 路由清单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/login | 登录，设置 httpOnly cookie |
| POST | /api/auth/logout | 登出 |
| GET | /api/auth/me | 当前用户 |
| GET | /api/tree | 文档文件树 |
| GET | /api/docs/[...path] | 读原始 md + 内容哈希 + frontmatter |
| PUT | /api/docs/[...path] | 保存（携带 baseHash，乐观锁） |
| DELETE | /api/docs/[...path] | 删除文件 |
| POST | /api/docs/move | 重命名/移动 {from, to} |
| POST | /api/preview | 渲染 md 文本为 HTML（编辑器实时预览） |
| GET | /api/assets/[...path] | 读取仓库内静态资源（图片等） |
| POST | /api/assets | 上传图片 → 写入 assets/ 并 commit/push |
| GET | /api/search?q= | FTS5 全文搜索 |
| GET | /api/history/[...path] | 文件 git log |
| GET | /api/diff?path=&from=&to= | 两版本 diff |
| POST | /api/webhook?token= | CodeHub webhook，验签后触发同步 |
| POST | /api/sync | 手动同步（admin） |
| GET | /api/admin/users / POST/DELETE | 用户管理（admin） |

约定：所有写操作返回 `{ ok: true, head }` 或 `{ ok: false, error }`；冲突返回 HTTP 409。

## 6. 错误处理矩阵

| 场景 | 行为 |
|---|---|
| 保存时内容已被他人修改 | 409 + 当前版本内容，前端展示对比，用户决定覆盖/合并 |
| push non-fast-forward | fetch + rebase 自动重试 ≤2 次 |
| rebase 冲突 | abort + reset --hard origin/branch，返回 409 |
| webhook 验签失败 | 401，不触发任何操作 |
| 同步时仓库不可达 | 记录 sync_state error，下次轮询再试，不影响浏览本地缓存 |
| 仓库未克隆（首次启动） | instrumentation 启动钩子执行初始克隆，失败则页面提示并每 30s 重试 |
| 路径穿越 (..) | 所有路径参数 normalize 后校验必须落在 repo 根内，否则 400 |

## 7. 渲染管线

```
remark-parse → remark-gfm → remark-frontmatter → remark-math
  → remark-rehype → rehype-highlight → rehype-katex
  → hast-util-to-jsx-runtime（RSC 内直接渲染为 React 元素）
```

- `language-mermaid` 代码块 → `<Mermaid>` 客户端组件（dynamic import mermaid）
- frontmatter 不进正文，编辑器中用独立面板编辑
- 内容来自可信内部仓库，不做 sanitize（如需对外开放再补 rehype-sanitize + 自定义 schema）
- 相对路径图片重写为 `/api/assets/<path>`

## 8. 安全要点

- 会话：httpOnly + SameSite=Lax cookie，HMAC-SHA256 签名，7 天过期，`AUTH_SECRET` 环境变量
- 密码：node:crypto scrypt（salt 16B），timingSafeEqual 比对
- webhook：`?token=` 或 `X-CodeHub-Token` 头与 `WEBHOOK_SECRET` 比对
- middleware 全站鉴权，仅放行 /login、/api/auth/*、/api/webhook
- 图片/资源接口同样要求登录
- git 凭据：SSH deploy key 挂载到容器，不出现在代码和日志中

## 9. 部署

- 单个 Dockerfile（node + git + openssh），卷挂载 `DATA_DIR`（SQLite + repo clone）
- 环境变量见 `.env.example`
- CodeHub 配置：仓库 Settings → Webhooks → URL 填 `https://<平台地址>/api/webhook?token=<WEBHOOK_SECRET>`，事件勾选 Push
- 兜底轮询 `POLL_INTERVAL_MS`（默认 600000）

## 10. 里程碑

- M1 骨架：认证 + 克隆/同步 + 只读渲染
- M2 编辑闭环：源码编辑 + 保存 push + 乐观锁 + webhook/轮询
- M3 编辑体验：WYSIWYG 双模式、图片上传、文件树增删改移动
- M4 增强：mermaid/公式、全文搜索、版本历史/diff
