#!/usr/bin/env bash
# SHE companion one-click launcher for macOS/Linux.
# Downloads a checksum-verified companion bundle into the current user's data dir,
# starts the local companion, and opens the PWA. Never uses sudo or requests root.
set -euo pipefail

TAG="${SHE_COMPANION_RELEASE_TAG:-v0.4.1-companion.1}"
BASE="${SHE_COMPANION_RELEASE_BASE:-https://github.com/pancong0711/she/releases/download/$TAG}"
INSTALL_ROOT="${SHE_COMPANION_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/she/companion}"
BIN_DIR="${SHE_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
PORT="${SHE_PWA_PORT:-8787}"
LOG="$INSTALL_ROOT/launcher.log"

if [ "$(id -u)" = "0" ]; then
  echo "✗ SHE companion must not run as root." >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "✗ Node.js 22.19+ / 24+ is required. Install it yourself; SHE does not request root." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "✗ curl is required." >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "✗ tar is required." >&2; exit 1; }
node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>=24 || (v[0]===22 && v[1]>=19) ? 0 : 1)" || { echo "✗ Node.js must be ^22.19.0 || >=24.0.0" >&2; exit 1; }

mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
touch "$LOG" 2>/dev/null || true
if command -v tee >/dev/null 2>&1; then
  exec > >(tee -a "$LOG") 2>&1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/she-start.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
echo "SHE launcher: fetching release manifest $BASE/companion-release-manifest.json"
curl -fL --retry 3 --connect-timeout 20 --max-time 120 -o "$WORK/manifest.json" "$BASE/companion-release-manifest.json"
node - "$WORK/manifest.json" > "$WORK/meta.env" <<'NODE'
const fs = require('fs')
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (m.schema !== 1 || !m.bundle || !m.version) throw new Error('invalid companion manifest')
process.stdout.write(`SHE_VERSION=${m.version}\nSHE_BUNDLE=${m.bundle.file}\nSHE_SHA=${m.bundle.sha256}\n`)
NODE
# shellcheck disable=SC1090
. "$WORK/meta.env"
echo "SHE launcher: companion $SHE_VERSION"
CURRENT_VERSION=""
if [ -f "$INSTALL_ROOT/current/apps/companion/server.mjs" ] && [ -f "$INSTALL_ROOT/current/VERSION" ]; then
  CURRENT_VERSION="$(tr -d '[:space:]' < "$INSTALL_ROOT/current/VERSION")"
fi
if [ "$CURRENT_VERSION" != "$SHE_VERSION" ]; then
  echo "SHE launcher: downloading $SHE_BUNDLE"
  curl -fL --retry 3 --connect-timeout 20 --max-time 300 -o "$WORK/$SHE_BUNDLE" "$BASE/$SHE_BUNDLE"
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$WORK/$SHE_BUNDLE" | awk '{print $1}')"
  else
    ACTUAL="$(shasum -a 256 "$WORK/$SHE_BUNDLE" | awk '{print $1}')"
  fi
  if [ "$ACTUAL" != "$SHE_SHA" ]; then
    echo "✗ SHA-256 mismatch: expected $SHE_SHA got $ACTUAL" >&2
    exit 1
  fi
  tar -xzf "$WORK/$SHE_BUNDLE" -C "$WORK"
  BUNDLE_DIR="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'she-companion-*' | head -n1)"
  [ -n "$BUNDLE_DIR" ] || { echo "✗ invalid companion bundle" >&2; exit 1; }
  DEST="$INSTALL_ROOT/versions/$SHE_VERSION"
  mkdir -p "$INSTALL_ROOT/versions"
  if [ -e "$DEST" ]; then
    echo "SHE launcher: replacing existing $DEST"
    rm -rf "$DEST"
  fi
  mv "$BUNDLE_DIR" "$DEST"
  if [ -L "$INSTALL_ROOT/current" ]; then
    ln -sfn "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/previous"
  fi
  ln -sfn "versions/$SHE_VERSION" "$INSTALL_ROOT/current"
  cat > "$BIN_DIR/she-companion" <<LAUNCHER
#!/usr/bin/env bash
set -euo pipefail
export SHE_COMPANION_ROOT="$INSTALL_ROOT"
export SHE_BIN_DIR="$BIN_DIR"
exec node "$INSTALL_ROOT/current/apps/companion/supervisor.mjs" "\$@"
LAUNCHER
  chmod 0755 "$BIN_DIR/she-companion"
  echo "SHE launcher: installed companion $SHE_VERSION"
fi

# A running companion cannot be replaced in-place by this launcher. Detect it
# before binding the port, otherwise the browser would keep showing the old API
# while the new process exits with EADDRINUSE.
if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/version" -o "$WORK/existing-version.json" 2>/dev/null; then
  EXISTING_VERSION="$(node -e "try { const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(d?.value?.companion ?? 'unknown')) } catch { process.stdout.write('unknown') }" "$WORK/existing-version.json" 2>/dev/null || printf 'unknown')"
  if [ "$EXISTING_VERSION" = "$SHE_VERSION" ]; then
    echo "SHE launcher: companion $SHE_VERSION is already running; opening http://127.0.0.1:$PORT"
    (sleep 0.5; for opener in xdg-open open; do if command -v "$opener" >/dev/null 2>&1; then "$opener" "http://127.0.0.1:$PORT" >/dev/null 2>&1 || true; break; fi; done) &
    exit 0
  fi
  echo "✗ 检测到旧 companion 正在运行：$EXISTING_VERSION" >&2
  echo "  已安装新版本：$SHE_VERSION" >&2
  echo "  请先停止正在运行的旧 companion（回到启动它的终端按 Ctrl+C，或结束对应进程），" >&2
  echo "  然后重新运行 start.sh。" >&2
  exit 1
fi

echo "SHE launcher: starting http://127.0.0.1:$PORT"
(sleep 1.2; for opener in xdg-open open; do if command -v "$opener" >/dev/null 2>&1; then "$opener" "http://127.0.0.1:$PORT" >/dev/null 2>&1 || true; break; fi; done) &
exec env SHE_PWA_PORT="$PORT" SHE_COMPANION_ROOT="$INSTALL_ROOT" SHE_BIN_DIR="$BIN_DIR" node "$INSTALL_ROOT/current/apps/companion/supervisor.mjs"
