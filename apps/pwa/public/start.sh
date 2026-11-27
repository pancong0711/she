#!/usr/bin/env bash
# Stable SHE companion bootstrap for macOS/Linux.
# This file only fetches the checksum-verified stable launcher. Installation,
# updates, restart, rollback and autostart all live outside this script.
set -euo pipefail

TAG="${SHE_COMPANION_RELEASE_TAG:-}"
if [ -n "$TAG" ]; then
  BASE="${SHE_COMPANION_RELEASE_BASE:-https://github.com/pancong0711/she/releases/download/$TAG}"
else
  BASE="${SHE_COMPANION_RELEASE_BASE:-https://github.com/pancong0711/she/releases/latest/download}"
fi
INSTALL_ROOT="${SHE_COMPANION_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/she/companion}"
BIN_DIR="${SHE_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
PORT="${SHE_PWA_PORT:-8787}"
MANIFEST_URL="${SHE_COMPANION_MANIFEST_URL:-$BASE/companion-release-manifest.json}"

if [ "$(id -u)" = "0" ]; then
  echo "✗ SHE companion must not run as root." >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "✗ Node.js 22.19+ / 24+ is required. Install it yourself; SHE does not request root." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "✗ curl is required." >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "✗ tar is required." >&2; exit 1; }
node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>=24 || (v[0]===22 && v[1]>=19) ? 0 : 1)" || { echo "✗ Node.js must be ^22.19.0 || >=24.0.0" >&2; exit 1; }

mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/she-launcher-bootstrap.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

launch_local() {
  [ -f "$INSTALL_ROOT/launcher.mjs" ] || return 1
  echo "SHE bootstrap: using installed launcher (release manifest unavailable)"
  exec env \
    SHE_PWA_PORT="$PORT" \
    SHE_COMPANION_ROOT="$INSTALL_ROOT" \
    SHE_BIN_DIR="$BIN_DIR" \
    SHE_COMPANION_MANIFEST_URL="$MANIFEST_URL" \
    SHE_LAUNCHER_UPDATE_ON_START=1 \
    node "$INSTALL_ROOT/launcher.mjs"
}

echo "SHE bootstrap: fetching launcher manifest"
if ! curl -fL --retry 3 --connect-timeout 20 --max-time 120 -o "$WORK/manifest.json" "$MANIFEST_URL"; then
  launch_local || { echo "✗ cannot download launcher manifest and no local launcher exists" >&2; exit 1; }
fi

# The launcher is a small standalone JS artifact. If an older manifest does not
# have launcher metadata, fall back to an already installed launcher.
LAUNCHER_META="$(node - "$WORK/manifest.json" <<'NODE'
const fs = require('fs')
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const file = manifest?.launcher?.file
const sha = manifest?.launcher?.sha256
if (typeof file !== 'string' || typeof sha !== 'string') process.exit(2)
process.stdout.write(`${file}\n${sha}\n`)
NODE
)" || { launch_local || { echo "✗ release manifest has no launcher artifact; run the latest start.sh once" >&2; exit 1; }; }
LAUNCHER_FILE="$(printf '%s\n' "$LAUNCHER_META" | sed -n '1p')"
LAUNCHER_SHA="$(printf '%s\n' "$LAUNCHER_META" | sed -n '2p')"
case "$LAUNCHER_FILE" in
  */*|..*) echo "✗ invalid launcher file name" >&2; exit 1 ;;
esac

echo "SHE bootstrap: downloading launcher $LAUNCHER_FILE"
curl -fL --retry 3 --connect-timeout 20 --max-time 120 -o "$WORK/$LAUNCHER_FILE" "$BASE/$LAUNCHER_FILE"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$WORK/$LAUNCHER_FILE" | awk '{print $1}')"
else
  ACTUAL="$(shasum -a 256 "$WORK/$LAUNCHER_FILE" | awk '{print $1}')"
fi
if [ "$ACTUAL" != "$LAUNCHER_SHA" ]; then
  echo "✗ launcher SHA-256 mismatch: expected $LAUNCHER_SHA got $ACTUAL" >&2
  exit 1
fi
node --check "$WORK/$LAUNCHER_FILE" >/dev/null
cp "$WORK/$LAUNCHER_FILE" "$INSTALL_ROOT/launcher.mjs.next"
chmod 0755 "$INSTALL_ROOT/launcher.mjs.next"
mv -f "$INSTALL_ROOT/launcher.mjs.next" "$INSTALL_ROOT/launcher.mjs"

exec env \
  SHE_PWA_PORT="$PORT" \
  SHE_COMPANION_ROOT="$INSTALL_ROOT" \
  SHE_BIN_DIR="$BIN_DIR" \
  SHE_COMPANION_MANIFEST_URL="$MANIFEST_URL" \
  SHE_LAUNCHER_UPDATE_ON_START=1 \
  node "$INSTALL_ROOT/launcher.mjs"
