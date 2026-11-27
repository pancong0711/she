#!/bin/bash
# Stable SHE launcher entrypoint for macOS.
set -euo pipefail

SHE_HOME="${SHE_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/she}"
if [ -n "${SHE_COMPANION_ROOT:-}" ]; then
  INSTALL_ROOT="$SHE_COMPANION_ROOT"
elif [ -f "$SHE_HOME/app/launcher.mjs" ]; then
  INSTALL_ROOT="$SHE_HOME/app"
elif [ -f "$SHE_HOME/companion/launcher.mjs" ]; then
  INSTALL_ROOT="$SHE_HOME/companion"
else
  INSTALL_ROOT="$SHE_HOME/app"
fi
if [ -n "${SHE_BIN_DIR:-}" ]; then
  BIN_DIR="$SHE_BIN_DIR"
elif [ -d "$SHE_HOME/bin" ] || [ ! -d "$HOME/.local/bin" ]; then
  BIN_DIR="$SHE_HOME/bin"
else
  BIN_DIR="$HOME/.local/bin"
fi
SHE_CORE_ROOT="${SHE_CORE_ROOT:-$SHE_HOME/core}"
SHE_CONFIG_HOME="${SHE_CONFIG_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/she}"
if [ ! -d "$SHE_HOME/config" ] && [ -d "${XDG_CONFIG_HOME:-$HOME/.config}/she" ]; then SHE_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/she"; else SHE_CONFIG_HOME="$SHE_HOME/config"; fi
SHE_STATE_HOME="${SHE_STATE_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/she}"
if [ ! -d "$SHE_HOME/state" ] && [ -d "${XDG_STATE_HOME:-$HOME/.local/state}/she" ]; then SHE_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/she"; else SHE_STATE_HOME="$SHE_HOME/state"; fi
SHE_RUNTIME_DIR="${SHE_RUNTIME_DIR:-${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/she}}"
SHE_RUNTIME_DIR="${SHE_RUNTIME_DIR:-$SHE_HOME/run}"
SHE_WORKSPACE_ROOT="${SHE_WORKSPACE_ROOT:-$SHE_HOME/workspaces}"
PORT="${SHE_PWA_PORT:-8787}"
export SHE_HOME SHE_COMPANION_ROOT="$INSTALL_ROOT" SHE_BIN_DIR="$BIN_DIR" SHE_CORE_ROOT SHE_CONFIG_HOME SHE_STATE_HOME SHE_RUNTIME_DIR SHE_WORKSPACE_ROOT

# After the first install, run the local launcher directly. The launcher owns
# environment checks, remote version checks, updates and supervision.
if [ "${SHE_FORCE_LAUNCHER_REFRESH:-0}" != "1" ] && [ -f "$INSTALL_ROOT/launcher.mjs" ]; then
  echo "SHE bootstrap: using installed launcher"
  exec env \
    SHE_HOME="$SHE_HOME" \
    SHE_PWA_PORT="$PORT" \
    SHE_COMPANION_ROOT="$INSTALL_ROOT" \
    SHE_BIN_DIR="$BIN_DIR" \
    SHE_CORE_ROOT="$SHE_CORE_ROOT" \
    SHE_CONFIG_HOME="$SHE_CONFIG_HOME" \
    SHE_STATE_HOME="$SHE_STATE_HOME" \
    SHE_RUNTIME_DIR="$SHE_RUNTIME_DIR" \
    SHE_WORKSPACE_ROOT="$SHE_WORKSPACE_ROOT" \
    SHE_LAUNCHER_UPDATE_ON_START=1 \
    node "$INSTALL_ROOT/launcher.mjs"
fi

TMP="$(mktemp -t she-start.XXXXXX.sh)"
trap 'rm -f "$TMP"' EXIT
curl -fL --retry 3 --connect-timeout 20 --max-time 120 -o "$TMP" "https://pancong0711.github.io/she/start.sh"
chmod +x "$TMP"
exec bash "$TMP"
