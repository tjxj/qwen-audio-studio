#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
DATA_ROOT="$HOME/Library/Application Support/Qwen Audio Studio"
PID_FILE="$DATA_ROOT/server.pid"
LOG_FILE="$DATA_ROOT/server.log"
URL="http://127.0.0.1:8765"
mkdir -p "$DATA_ROOT"

if [ ! -x "$ROOT/.venv/bin/python" ] || [ ! -f "$ROOT/frontend/dist/index.html" ]; then
  osascript -e 'display alert "Qwen Audio Studio 尚未安装" message "请先双击“安装 Qwen Audio Studio.command”完成一次性安装。"'
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  EXISTING_COMMAND="$(ps -p "$EXISTING_PID" -o command= 2>/dev/null || true)"
  if kill -0 "$EXISTING_PID" 2>/dev/null && [[ "$EXISTING_COMMAND" == *"$ROOT/backend/run.py"* ]]; then
    open "$URL"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  osascript -e 'display alert "缺少 ffmpeg" message "请先安装 ffmpeg，并重新启动 Qwen Audio Studio。"'
  exit 1
fi

cd "$ROOT"
nohup "$ROOT/.venv/bin/python" "$ROOT/backend/run.py" >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

for _ in {1..50}; do
  if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
    open "$URL"
    exit 0
  fi
  sleep 0.2
done

kill "$SERVER_PID" 2>/dev/null || true
rm -f "$PID_FILE"
osascript -e 'display alert "Qwen Audio Studio 启动失败" message "请检查本地 server.log。"'
exit 1
