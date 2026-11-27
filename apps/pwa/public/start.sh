#!/usr/bin/env bash
# Stable SHE companion bootstrap for macOS/Linux.
# This file only fetches the checksum-verified stable launcher. Installation,
# updates, restart, rollback and autostart all live outside this script.
set -euo pipefail

TAG="${SHE_COMPANION_RELEASE_TAG:-}"
if [ -n "$TAG" ]; then
  BASE="${SHE_COMPANION_RELEASE_BASE:-https://github.com/pancong0711/she/releases/download/$TAG}"
else
  BASE="${SHE_COMPANION_RELEASE_BASE:-}"
fi
SHE_HOME="${SHE_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/she}"
if [ -n "${SHE_COMPANION_ROOT:-}" ]; then
  INSTALL_ROOT="$SHE_COMPANION_ROOT"
elif [ -f "$SHE_HOME/app/launcher.mjs" ]; then
  INSTALL_ROOT="$SHE_HOME/app"
elif [ -f "$SHE_HOME/companion/launcher.mjs" ]; then
  # Legacy layout remains runnable until the one-time migration is applied.
  INSTALL_ROOT="$SHE_HOME/companion"
else
  INSTALL_ROOT="$SHE_HOME/app"
fi
if [ -n "${SHE_BIN_DIR:-}" ]; then
  BIN_DIR="$SHE_BIN_DIR"
elif [ "$INSTALL_ROOT" = "$SHE_HOME/companion" ] && [ -d "$HOME/.local/bin" ]; then
  # Preserve the legacy command location only when running a legacy install.
  BIN_DIR="$HOME/.local/bin"
else
  BIN_DIR="$SHE_HOME/bin"
fi
SHE_CORE_ROOT="${SHE_CORE_ROOT:-$SHE_HOME/core}"
if [ -n "${SHE_CONFIG_HOME:-}" ]; then
  :
elif [ -f "$SHE_HOME/config/token" ] || [ ! -d "${XDG_CONFIG_HOME:-$HOME/.config}/she" ]; then
  SHE_CONFIG_HOME="$SHE_HOME/config"
else
  SHE_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/she"
fi
if [ -n "${SHE_STATE_HOME:-}" ]; then
  :
elif [ -f "$SHE_HOME/state/she.db" ] || [ ! -d "${XDG_STATE_HOME:-$HOME/.local/state}/she" ]; then
  SHE_STATE_HOME="$SHE_HOME/state"
else
  SHE_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/she"
fi
SHE_RUNTIME_DIR="${SHE_RUNTIME_DIR:-${XDG_RUNTIME_DIR:-$SHE_HOME/run}}"
if [ "${XDG_RUNTIME_DIR:-}" != "" ] && [ -z "${SHE_RUNTIME_DIR:-}" ]; then SHE_RUNTIME_DIR="$XDG_RUNTIME_DIR/she"; fi
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ "$SHE_RUNTIME_DIR" = "$XDG_RUNTIME_DIR" ]; then SHE_RUNTIME_DIR="$XDG_RUNTIME_DIR/she"; fi
SHE_WORKSPACE_ROOT="${SHE_WORKSPACE_ROOT:-$SHE_HOME/workspaces}"
PORT="${SHE_PWA_PORT:-8787}"
export SHE_HOME SHE_COMPANION_ROOT="$INSTALL_ROOT" SHE_BIN_DIR="$BIN_DIR" SHE_CORE_ROOT SHE_CONFIG_HOME SHE_STATE_HOME SHE_RUNTIME_DIR SHE_WORKSPACE_ROOT
if [ -n "${SHE_COMPANION_MANIFEST_URL:-}" ]; then
  MANIFEST_URL="$SHE_COMPANION_MANIFEST_URL"
elif [ -n "$BASE" ]; then
  MANIFEST_URL="$BASE/companion-release-manifest.json"
else
  MANIFEST_URL="https://pancong0711.github.io/she/companion-release-manifest.json"
fi

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
    SHE_COMPANION_MANIFEST_URL="$MANIFEST_URL" \
    SHE_LAUNCHER_UPDATE_ON_START=1 \
    node "$INSTALL_ROOT/launcher.mjs"
}

# GitHub release downloads can intermittently fail with TLS EOF/proxy errors.
# Try system curl first for compatibility, then Node's fetch stack.
download_file() {
  local url="$1"
  local output="$2"
  local max_seconds="${3:-120}"
  if curl -fL --http1.1 --retry 3 --retry-delay 1 --connect-timeout 20 --max-time "$max_seconds" -o "$output" "$url"; then
    return 0
  fi
  echo "SHE bootstrap: curl download failed; retrying with Node fetch" >&2
  node --input-type=module - "$url" "$output" "$max_seconds" <<'NODE'
const [url, output, maxSeconds] = process.argv.slice(2)
try {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(Number(maxSeconds) * 1_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(output, Buffer.from(await response.arrayBuffer()))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
NODE
}

# Once installed, the local launcher is the application entrypoint. It owns
# environment checks, remote version checks, updates and process supervision.
# Set SHE_FORCE_LAUNCHER_REFRESH=1 only to repair/replace the launcher itself.
if [ "${SHE_FORCE_LAUNCHER_REFRESH:-0}" != "1" ] && [ -f "$INSTALL_ROOT/launcher.mjs" ]; then
  echo "SHE bootstrap: using installed launcher"
  launch_local
fi

echo "SHE bootstrap: no usable local launcher; fetching launcher manifest"
if ! download_file "$MANIFEST_URL" "$WORK/manifest.json" 30; then
  launch_local || { echo "✗ cannot download launcher manifest and no local launcher exists" >&2; exit 1; }
fi

# The launcher is a small standalone JS artifact. If an older manifest does not
# have launcher metadata, fall back to an already installed launcher.
LAUNCHER_META="$(node - "$WORK/manifest.json" <<'NODE'
const fs = require('fs')
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const file = manifest?.launcher?.file
const sha = manifest?.launcher?.sha256
const url = manifest?.launcher?.url
const fallbackUrl = manifest?.launcher?.fallbackUrl
if (typeof file !== 'string' || typeof sha !== 'string') process.exit(2)
process.stdout.write(`${file}\n${sha}\n${typeof url === 'string' ? url : ''}\n${typeof fallbackUrl === 'string' ? fallbackUrl : ''}\n`)
NODE
)" || { launch_local || { echo "✗ release manifest has no launcher artifact; run the latest start.sh once" >&2; exit 1; }; }
LAUNCHER_FILE="$(printf '%s\n' "$LAUNCHER_META" | sed -n '1p')"
LAUNCHER_SHA="$(printf '%s\n' "$LAUNCHER_META" | sed -n '2p')"
LAUNCHER_URL="$(printf '%s\n' "$LAUNCHER_META" | sed -n '3p')"
LAUNCHER_FALLBACK_URL="$(printf '%s\n' "$LAUNCHER_META" | sed -n '4p')"
case "$LAUNCHER_FILE" in
  */*|..*) echo "✗ invalid launcher file name" >&2; exit 1 ;;
esac
if [ -z "$LAUNCHER_URL" ]; then
  if [ -z "$BASE" ]; then
    echo "✗ release manifest has no launcher URL and no release base was provided" >&2
    exit 1
  fi
  LAUNCHER_URL="$BASE/$LAUNCHER_FILE"
fi
case "$LAUNCHER_URL" in
  https://*|file://*) ;;
  *) echo "✗ launcher URL must use https:// or file://" >&2; exit 1 ;;
esac

# The Pages channel also mirrors the bundled launcher next to its manifest.
# This gives fresh installs a second host when GitHub release downloads fail.
if [ -z "$LAUNCHER_FALLBACK_URL" ]; then
  LAUNCHER_FALLBACK_URL="$(node -e "process.stdout.write(new URL(process.argv[1], process.argv[2]).href)" "$LAUNCHER_FILE" "$MANIFEST_URL")"
fi

download_and_verify_launcher() {
  local url="$1"
  echo "SHE bootstrap: downloading launcher $LAUNCHER_FILE from $url"
  download_file "$url" "$WORK/$LAUNCHER_FILE" 45 || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$WORK/$LAUNCHER_FILE" | awk '{print $1}')"
  else
    ACTUAL="$(shasum -a 256 "$WORK/$LAUNCHER_FILE" | awk '{print $1}')"
  fi
  if [ "$ACTUAL" != "$LAUNCHER_SHA" ]; then
    echo "✗ launcher SHA-256 mismatch: expected $LAUNCHER_SHA got $ACTUAL" >&2
    return 1
  fi
  node --check "$WORK/$LAUNCHER_FILE" >/dev/null
}

if ! download_and_verify_launcher "$LAUNCHER_URL"; then
  if [ "$LAUNCHER_FALLBACK_URL" != "$LAUNCHER_URL" ]; then
    echo "SHE bootstrap: primary launcher download failed; trying channel mirror"
    download_and_verify_launcher "$LAUNCHER_FALLBACK_URL" || launch_local || {
      echo "✗ cannot download a verified launcher and no local launcher exists" >&2
      exit 1
    }
  else
    launch_local || {
      echo "✗ cannot download a verified launcher and no local launcher exists" >&2
      exit 1
    }
  fi
fi
cp "$WORK/$LAUNCHER_FILE" "$INSTALL_ROOT/launcher.mjs.next"
chmod 0755 "$INSTALL_ROOT/launcher.mjs.next"
mv -f "$INSTALL_ROOT/launcher.mjs.next" "$INSTALL_ROOT/launcher.mjs"

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
  SHE_COMPANION_MANIFEST_URL="$MANIFEST_URL" \
  SHE_LAUNCHER_UPDATE_ON_START=1 \
  node "$INSTALL_ROOT/launcher.mjs"
