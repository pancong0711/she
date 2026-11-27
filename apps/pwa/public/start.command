#!/bin/bash
# Stable SHE launcher entrypoint for macOS.
set -euo pipefail

INSTALL_ROOT="${SHE_COMPANION_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/she/companion}"
BIN_DIR="${SHE_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
PORT="${SHE_PWA_PORT:-8787}"

# After the first install, run the local launcher directly. The launcher owns
# environment checks, remote version checks, updates and supervision.
if [ "${SHE_FORCE_LAUNCHER_REFRESH:-0}" != "1" ] && [ -f "$INSTALL_ROOT/launcher.mjs" ]; then
  echo "SHE bootstrap: using installed launcher"
  exec env \
    SHE_PWA_PORT="$PORT" \
    SHE_COMPANION_ROOT="$INSTALL_ROOT" \
    SHE_BIN_DIR="$BIN_DIR" \
    SHE_LAUNCHER_UPDATE_ON_START=1 \
    node "$INSTALL_ROOT/launcher.mjs"
fi

TMP="$(mktemp -t she-start.XXXXXX.sh)"
trap 'rm -f "$TMP"' EXIT
curl -fL --retry 3 --connect-timeout 20 --max-time 120 -o "$TMP" "https://pancong0711.github.io/she/start.sh"
chmod +x "$TMP"
exec bash "$TMP"
