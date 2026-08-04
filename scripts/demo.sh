#!/usr/bin/env bash
# 本地演示：创建一个模拟"远端"的 bare 仓库并启动平台
# 默认生产模式（快）；--dev 启动开发模式（改代码热更新用）
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ROOT=$PWD

DEMO_DIR=${DEMO_DIR:-/tmp/gitmd-demo}
PORT=${PORT:-3000}
MODE=${1:-prod}

if [ ! -d "$DEMO_DIR/remote.git" ]; then
  echo "==> 创建模拟远端仓库 $DEMO_DIR/remote.git"
  mkdir -p "$DEMO_DIR"
  git init --bare -b main "$DEMO_DIR/remote.git" -q
  git clone -q "$DEMO_DIR/remote.git" "$DEMO_DIR/seed"
  cd "$DEMO_DIR/seed"
  mkdir -p guide
  cat > README.md <<'MD'
---
title: 首页
---

# 欢迎使用 GitMD

- 左侧是文档树，可新建/重命名/删除
- 点「编辑」进入编辑器（源码 / 所见即所得双模式，Ctrl+S 保存并推送）
- 支持 **GFM**、数学公式 $\int x dx$、mermaid 图表

```mermaid
graph LR
  A[平台编辑] --> B[git push]
  C[外部提交] --> D[webhook/轮询] --> E[平台同步]
```
MD
  echo "# 上手指南

这是一篇示例文档。" > guide/getting-started.md
  # 平台自身文档（dogfooding）：从项目仓库复制，修正相对链接
  mkdir -p platform
  sed -e 's|(docs/DESIGN\.md)|(DESIGN.md)|g' \
      -e 's|\[\.env\.example\](\.env\.example)|`.env.example`|g' \
      "$PROJECT_ROOT/README.md" > platform/README.md
  cp "$PROJECT_ROOT/docs/DESIGN.md" platform/DESIGN.md
  git add -A
  git -c user.name=demo -c user.email=demo@local commit -q -m "init docs"
  git push -q origin main
  cd - > /dev/null
fi

export DATA_DIR="$DEMO_DIR/data" \
  REPO_URL="$DEMO_DIR/remote.git" \
  AUTH_SECRET=demo-secret \
  WEBHOOK_SECRET=demo-hook-secret \
  POLL_INTERVAL_MS=30000

if [ "$MODE" = "--dev" ]; then
  echo "==> 开发模式启动  http://localhost:$PORT  (admin / admin123)"
  npx next dev -p "$PORT"
else
  echo "==> 生产模式启动  http://localhost:$PORT  (admin / admin123)"
  echo "    （如需改代码热更新：bash scripts/demo.sh --dev）"
  npm run build && npx next start -p "$PORT"
fi
