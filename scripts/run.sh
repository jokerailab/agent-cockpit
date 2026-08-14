#!/usr/bin/env bash
# Convenience launcher for running Agent Cockpit locally.
#   ./scripts/run.sh           → interactive menu
#   ./scripts/run.sh dev       → skip menu, run that mode directly
# Modes: dev | app | dmg
#
# This launches the app. For the unit test suite, run `npm test`.
set -uo pipefail
cd "$(dirname "$0")/.."

clean() {
  # clear stale instances so the single-instance lock / dev port are free
  pkill -f "electron-vite dev" 2>/dev/null || true
  osascript -e 'quit app "Agent Cockpit"' >/dev/null 2>&1 || true
  pkill -f "agent-cockpit/node_modules/electron" 2>/dev/null || true
  sleep 1
}

mode="${1:-}"
if [ -z "$mode" ]; then
  echo ""
  echo "  Agent Cockpit — 本地运行"
  echo "  ──────────────────────────────"
  echo "  1) dev    热更开发 (日常, 秒级)        ← 默认"
  echo "  2) app    打包版 .app (验证打包行为)"
  echo "  3) dmg    出完整 dmg (发版给别人)"
  echo ""
  printf "  选 [1]: "
  read -r choice
  case "$choice" in
    2) mode="app" ;;
    3) mode="dmg" ;;
    *) mode="dev" ;;
  esac
fi

case "$mode" in
  dev)
    echo "▸ 清理残留实例…"; clean
    echo "▸ 启动热更开发 (改代码即时生效; 若白屏按 Cmd+R)…"
    exec npm run dev
    ;;
  app)
    echo "▸ 清理残留实例…"; clean
    exec bash scripts/run-packaged.sh
    ;;
  dmg)
    exec bash scripts/release-mac.sh
    ;;
  *)
    echo "未知模式: $mode (用 dev|app|dmg)"; exit 1
    ;;
esac
