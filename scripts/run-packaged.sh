#!/usr/bin/env bash
# Fast packaged-app test loop: build the .app only (no dmg) and launch it.
#   ./scripts/run-packaged.sh
# Use this to verify isPackaged-only behaviour (auto-launch, productName, tray
# in a real bundle). For normal feature work use `npm run dev` instead.
set -euo pipefail
cd "$(dirname "$0")/.."

export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
export CSC_IDENTITY_AUTO_DISCOVERY=false

APP="release/mac-arm64/Agent Cockpit.app"

# quit a previous instance so the single-instance lock is free
osascript -e 'quit app "Agent Cockpit"' >/dev/null 2>&1 || true

echo "▸ building app bundle (no dmg)…"
npm run build
npx electron-builder --mac --dir

echo "▸ launching $APP"
open "$APP"
