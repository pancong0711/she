#!/usr/bin/env bash
# Install a SHE core bundle into a user-level versioned directory.
# Does not start/stop processes; process switching belongs to companion updates.
#
# Usage:
#   bash scripts/install-core-bundle.sh <bundle.tar.gz> [--sha256 <hash>] [--core-root <dir>] [--force]
set -euo pipefail

ARCHIVE=""
EXPECTED_SHA=""
CORE_ROOT="${SHE_CORE_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/she/core}"
FORCE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha256) EXPECTED_SHA="${2:-}"; shift 2 ;;
    --core-root) CORE_ROOT="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done

if [ -z "$ARCHIVE" ]; then echo "usage: $0 <bundle.tar.gz> [--sha256 <hash>] [--core-root <dir>] [--force]" >&2; exit 2; fi
if [ ! -f "$ARCHIVE" ]; then echo "bundle not found: $ARCHIVE" >&2; exit 1; fi
if [ "$(id -u)" = "0" ]; then echo "✗ must not run as root" >&2; exit 1; fi
if [ -n "$EXPECTED_SHA" ]; then
  ACTUAL_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
  if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then echo "✗ SHA-256 mismatch" >&2; exit 1; fi
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/she-core-install.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$ARCHIVE" -C "$TMP"
BUNDLE_DIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d -name 'she-core-*' | head -n1)"
if [ -z "$BUNDLE_DIR" ] || [ ! -f "$BUNDLE_DIR/VERSION" ]; then
  echo "✗ invalid core bundle: VERSION missing" >&2; exit 1
fi
VERSION="$(tr -d '[:space:]' < "$BUNDLE_DIR/VERSION")"
DEST="$CORE_ROOT/versions/$VERSION"
mkdir -p "$CORE_ROOT/versions" "$CORE_ROOT/staging"
if [ -e "$DEST" ] && [ "$FORCE" -ne 1 ]; then
  echo "✗ version already installed: $DEST (use --force to replace)" >&2; exit 1
fi

if [ -L "$CORE_ROOT/current" ]; then
  OLD_TARGET="$(readlink "$CORE_ROOT/current")"
  ln -sfn "$OLD_TARGET" "$CORE_ROOT/previous"
fi
rm -rf "$DEST"
mv "$BUNDLE_DIR" "$DEST"
ln -sfn "versions/$VERSION" "$CORE_ROOT/current"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$CORE_ROOT/state.json" <<JSON
{
  "schema": 1,
  "current": "$VERSION",
  "installedAt": "$NOW",
  "sourceArchive": "$(basename "$ARCHIVE")"
}
JSON

echo "✓ installed SHE core $VERSION"
echo "  current: $CORE_ROOT/current -> versions/$VERSION"
echo "  entrypoint: $CORE_ROOT/current/run-core.sh"
