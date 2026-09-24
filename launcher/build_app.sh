#!/bin/bash
set -euo pipefail

LAUNCHER_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$LAUNCHER_DIR/.." && pwd)"
DESTINATION="${1:-$PROJECT_ROOT/Qwen Audio Studio.app}"

case "$DESTINATION" in
  *.app) ;;
  *) echo "目标必须以 .app 结尾" >&2; exit 2 ;;
esac
if [ -e "$DESTINATION" ] && [ ! -f "$DESTINATION/Contents/Info.plist" ]; then
  echo "拒绝覆盖非应用目录: $DESTINATION" >&2
  exit 2
fi
rm -rf "$DESTINATION"
mkdir -p "$DESTINATION/Contents/MacOS"
cp "$LAUNCHER_DIR/Info.plist" "$DESTINATION/Contents/Info.plist"
/usr/bin/clang -O2 -Wall -Wextra \
  "$LAUNCHER_DIR/QwenAudioStudio.c" \
  -o "$DESTINATION/Contents/MacOS/QwenAudioStudio"
/usr/bin/clang -O2 -Wall -Wextra -framework Cocoa \
  "$LAUNCHER_DIR/DirectoryPicker.m" -o "$LAUNCHER_DIR/DirectoryPicker"
mkdir -p "$LAUNCHER_DIR/Qwen Folder Picker.app/Contents/MacOS"
cp "$LAUNCHER_DIR/DirectoryPicker-Info.plist" "$LAUNCHER_DIR/Qwen Folder Picker.app/Contents/Info.plist"
cp "$LAUNCHER_DIR/DirectoryPicker" "$LAUNCHER_DIR/Qwen Folder Picker.app/Contents/MacOS/DirectoryPicker"
