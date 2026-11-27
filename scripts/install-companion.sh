#!/usr/bin/env bash
# Checksum-verified user-level installer for she-companion.
# Never runs as root and never installs Node/Docker/system services.
#
# Usage:
#   bash install-companion.sh she-companion-<version>.tar.gz --sha256 <hash> [--install-root <dir>]
set -euo pipefail

ARCHIVE=""
EXPECTED_SHA=""
SHE_HOME="${SHE_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/she}"
INSTALL_ROOT="${SHE_COMPANION_ROOT:-$SHE_HOME/app}"
BIN_DIR="${SHE_BIN_DIR:-$SHE_HOME/bin}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha256) EXPECTED_SHA="${2:-}"; shift 2 ;;
    --install-root) INSTALL_ROOT="${2:-}"; shift 2 ;;
    --bin-dir) BIN_DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then echo "usage: $0 <bundle.tar.gz> --sha256 <hash> [--install-root <dir>]" >&2; exit 2; fi
if [ "$(id -u)" = "0" ]; then echo "✗ SHE companion must not be installed as root" >&2; exit 1; fi
if [ -n "$EXPECTED_SHA" ]; then
  ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
  if [ "$ACTUAL" != "$EXPECTED_SHA" ]; then echo "✗ SHA-256 mismatch" >&2; exit 1; fi
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/she-companion-install.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$ARCHIVE" -C "$TMP"
BUNDLE_DIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d -name 'she-companion-*' | head -n1)"
if [ -z "$BUNDLE_DIR" ] || [ ! -f "$BUNDLE_DIR/VERSION" ]; then echo "✗ invalid companion bundle" >&2; exit 1; fi
VERSION="$(tr -d '[:space:]' < "$BUNDLE_DIR/VERSION")"
DEST="$INSTALL_ROOT/versions/$VERSION"
mkdir -p "$INSTALL_ROOT/versions" "$INSTALL_ROOT/staging"
if [ -e "$DEST" ]; then echo "✗ companion $VERSION already installed: $DEST" >&2; exit 1; fi
if [ -L "$INSTALL_ROOT/current" ]; then ln -sfn "$(readlink "$INSTALL_ROOT/current")" "$INSTALL_ROOT/previous"; fi
mv "$BUNDLE_DIR" "$DEST"
ln -sfn "versions/$VERSION" "$INSTALL_ROOT/current"
if [ -f "$DEST/bin/she-launcher.mjs" ]; then
  cp "$DEST/bin/she-launcher.mjs" "$INSTALL_ROOT/launcher.mjs"
  chmod 0755 "$INSTALL_ROOT/launcher.mjs"
fi
cat > "$INSTALL_ROOT/state.json" <<JSON
{"schema":1,"current":"$VERSION","installedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","sourceArchive":"$(basename "$ARCHIVE")"}
JSON
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/she" <<LAUNCHER
#!/usr/bin/env bash
set -euo pipefail
export SHE_HOME="$SHE_HOME"
export SHE_COMPANION_ROOT="$INSTALL_ROOT"
export SHE_BIN_DIR="$BIN_DIR"
export SHE_CORE_ROOT="${SHE_CORE_ROOT:-$SHE_HOME/core}"
export SHE_CONFIG_HOME="${SHE_CONFIG_HOME:-$SHE_HOME/config}"
export SHE_STATE_HOME="${SHE_STATE_HOME:-$SHE_HOME/state}"
export SHE_RUNTIME_DIR="${SHE_RUNTIME_DIR:-$SHE_HOME/run}"
export SHE_WORKSPACE_ROOT="${SHE_WORKSPACE_ROOT:-$SHE_HOME/workspaces}"
if [ -f "$INSTALL_ROOT/launcher.mjs" ]; then
  exec node "$INSTALL_ROOT/launcher.mjs" "\$@"
fi
exec node "$INSTALL_ROOT/current/apps/companion/supervisor.mjs" "\$@"
LAUNCHER
chmod 0755 "$BIN_DIR/she"
cp "$BIN_DIR/she" "$BIN_DIR/she-companion"
chmod 0755 "$BIN_DIR/she-companion"
echo "✓ installed SHE app $VERSION"
echo "  current: $INSTALL_ROOT/current"
echo "  launcher: $BIN_DIR/she"
echo "  next: ensure $BIN_DIR is on PATH, then run: she"
