#!/bin/bash
# 启动「小学知识成长地图」预览服务（宿主机网络，常驻）
# 用法：在终端执行  bash /Users/jeremy/WorkBuddy/2026-08-31-17-11-25/start-preview.sh
# 然后用 Safari 打开 http://localhost:4173/
set -e
cd "$(dirname "$0")"

# 若已有 4173 端口占用则先释放
if lsof -ti:4173 >/dev/null 2>&1; then
  echo "检测到 4173 端口已占用，先释放…"
  lsof -ti:4173 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo "启动预览服务 → http://localhost:4173/  (Ctrl+C 停止)"
exec npx vite preview --port 4173 --host
