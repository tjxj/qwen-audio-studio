#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
for dependency in python3 npm ffmpeg ffprobe /usr/bin/clang; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "缺少依赖: $dependency"
    exit 1
  fi
done

python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend install
npm --prefix frontend run build

chmod +x launcher/build_app.sh
launcher/build_app.sh
echo "安装完成。以后双击 Qwen Audio Studio.app 即可启动。"
open "$ROOT"
