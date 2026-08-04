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
| 批注存储 | 仓库内 YAML sidecar（`.gitmd/annotations/*.yaml`），随 git 同步分发；锚点随版本自动重定位 |

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
  git_name      TEXT,                   -- 提交身份（author 显示名），启动时 ALTER 迁移补齐
  git_email     TEXT,                   -- 提交身份邮箱
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
存量库的 schema 演进用 `PRAGMA table_info` 探测后按需 `ALTER TABLE`，不做版本化迁移框架。

## 5. API 路由清单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/login | 登录，设置 httpOnly cookie |
| POST | /api/auth/logout | 登出 |
| GET | /api/auth/me | 当前用户 |
| PUT | /api/auth/profile | 修改个人 Git 提交身份（git_name / git_email） |
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
| GET | /api/annotations?path= | 读取文档批注（含锚点重定位） |
| POST | /api/annotations | 新建批注（commit + push） |
| POST | /api/annotations/action | 标记解决 / 重新打开 / 删除（仅本人） |
| POST | /api/webhook?token= | CodeHub webhook，验签后触发同步 |
| POST | /api/sync | 手动同步（admin） |
| GET/POST | /api/admin/users | 用户列表 / 新建用户（admin） |
| PUT/DELETE | /api/admin/users/[id] | 改密码（本人或 admin）/ 删除用户（admin，不可删自己） |

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

## 8. 批注系统

批注是对文档片段的行内讨论，**数据存放在仓库内而非 SQLite**，随 git 同步天然分发、可在 Git 侧直接审阅，符合"仓库是唯一数据源"的原则。

### 8.1 存储格式

每篇文档一个 sidecar 文件：`.gitmd/annotations/<doc路径>.yaml`（如 `guide/a.md` → `.gitmd/annotations/guide/a.md.yaml`）。写入走与编辑相同的 `withWriteOp` 通道（串行队列 + commit + push，author = 操作者）。

### 8.2 锚点模型

锚点是源码位置 + 文本上下文 + Git 版本 + AST 信息的组合：

| 字段 | 作用 |
|---|---|
| quote / prefix / suffix | 精确匹配与模糊重定位的主锚点（前后文各 40 字符） |
| start / end | 创建时（base 版本）的正文偏移，快速路径；偏移基于去掉 frontmatter 的正文，与渲染节点 `data-source-*` 坐标系一致 |
| base | 创建时的 commit SHA，用于 diff 平移 |
| section | 所在最近标题文本，重名 quote 时辅助投票 |

### 8.3 重定位策略（读取时计算，不回写）

每次读取批注时按序尝试，直到定位成功：

1. **exact**：quote 在原文位置或全局唯一命中
2. **relocated**：`git diff base..HEAD -U0` 得到行映射，把 base 偏移平移到当前版本（同文档的所有批注按 base 分组，共享一次 `git show` / `git diff`，批量在单个锁内完成）
3. **fuzzy**：prefix/suffix/section 加权投票找最佳候选
4. **orphaned**：全部失败——原文已删除或大改，前端收进右下角「失效批注」面板，可解决/删除，不丢数据

### 8.4 交互模型

- 同一段文字可叠加多条独立批注（平铺按时间排序），每条批注内可追加多条评论
- 标记解决 / 重新打开任何登录用户可操作；删除仅限批注作者本人
- 前端气泡用 `position: absolute` 锚定在正文附近，随页面滚动

## 9. 安全要点

- 会话：httpOnly + SameSite=Lax cookie，HMAC-SHA256 签名，7 天过期，`AUTH_SECRET` 环境变量
- 密码：node:crypto scrypt（salt 16B），timingSafeEqual 比对
- webhook：`?token=` 或 `X-CodeHub-Token` 头与 `WEBHOOK_SECRET` 比对
- middleware 全站鉴权，仅放行 /login、/api/auth/*、/api/webhook
- 图片/资源接口同样要求登录
- git 凭据：SSH deploy key 挂载到容器，不出现在代码和日志中

## 10. 部署

- 单个 Dockerfile（node + git + openssh），卷挂载 `DATA_DIR`（SQLite + repo clone）
- 环境变量见 `.env.example`
- CodeHub 配置：仓库 Settings → Webhooks → URL 填 `https://<平台地址>/api/webhook?token=<WEBHOOK_SECRET>`，事件勾选 Push
- 兜底轮询 `POLL_INTERVAL_MS`（默认 600000）

## 11. 里程碑

- M1 骨架：认证 + 克隆/同步 + 只读渲染
- M2 编辑闭环：源码编辑 + 保存 push + 乐观锁 + webhook/轮询
- M3 编辑体验：WYSIWYG 双模式、图片上传、文件树增删改移动
- M4 增强：mermaid/公式、全文搜索、版本历史/diff
- M5 协作：批注系统（锚点重定位、仓库内 sidecar 存储）
