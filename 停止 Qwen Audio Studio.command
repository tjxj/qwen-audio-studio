#!/bin/bash
set -euo pipefail

DATA_ROOT="$HOME/Library/Application Support/Qwen Audio Studio"
PID_FILE="$DATA_ROOT/server.pid"
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$PID_FILE" ]; then
  exit 0
fi

SERVER_PID="$(cat "$PID_FILE")"
SERVER_COMMAND="$(ps -p "$SERVER_PID" -o command= 2>/dev/null || true)"
if kill -0 "$SERVER_PID" 2>/dev/null && [[ "$SERVER_COMMAND" == *"$ROOT/backend/run.py"* ]]; then
  kill "$SERVER_PID"
fi
rm -f "$PID_FILE"
