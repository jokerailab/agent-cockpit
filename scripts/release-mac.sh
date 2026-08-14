#!/usr/bin/env bash
# One-command macOS (arm64) release build.
#   ./scripts/release-mac.sh
#
# Produces an ad-hoc-signed dmg at release/Agent Cockpit-<ver>-arm64.dmg.
# No Apple Developer account / notarization — users do a one-time
# System Settings → Privacy & Security → "Open Anyway" (steps are baked into
# the dmg background, see scripts/make-dmg-bg.py).
set -euo pipefail
cd "$(dirname "$0")/.."

# CN mirrors for Electron headers + electron-builder helper binaries.
# Local-only: on CI the default endpoints are reachable and faster, and these
# mirrors would just add a failure mode.
if [ -z "${CI:-}" ]; then
  export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
  export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
fi
# no cert → skip electron-builder signing; our afterPack hook ad-hoc deep-signs
export CSC_IDENTITY_AUTO_DISCOVERY=false

echo "▸ regenerating dmg background…"
python3 scripts/make-dmg-bg.py

echo "▸ typecheck…"
npm run typecheck

echo "▸ building renderer/main/preload…"
npm run build

echo "▸ packaging dmg (arm64, ad-hoc signed, better-sqlite3 rebuilt for Electron ABI)…"
npx electron-builder --mac

echo ""
echo "✓ done:"
ls -lh release/*.dmg | awk '{print "  " $5, $9}'
echo "  verify: codesign --verify --deep --strict \"release/mac-arm64/Agent Cockpit.app\""
