#!/usr/bin/env bash
# Build the stable companion distribution bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${OUT_DIR:-$ROOT/artifacts/companion}}"
VERSION="$(node -e "process.stdout.write(require('$ROOT/package.json').version)")"
STAGE="$OUT_DIR/she-companion-$VERSION"
ARCHIVE="$OUT_DIR/she-companion-$VERSION.tar.gz"

cd "$ROOT"
pnpm pwa:build
rm -rf "$STAGE" "$ARCHIVE"
mkdir -p "$STAGE/apps/companion" "$STAGE/apps/pwa" "$STAGE/scripts" "$STAGE/bin"

cp apps/companion/server.mjs apps/companion/package.json "$STAGE/apps/companion/"
cp -a apps/pwa/dist "$STAGE/apps/pwa/dist"
cp scripts/bootstrap-user.sh scripts/bootstrap-user.ps1 scripts/install-core-bundle.sh "$STAGE/scripts/"
cp scripts/install-companion.sh scripts/install-companion.ps1 "$STAGE/scripts/"
cp LICENSE README.md "$STAGE/"
printf '%s\n' "$VERSION" > "$STAGE/VERSION"
cat > "$STAGE/bin/she-companion" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/apps/companion/server.mjs" "$@"
LAUNCHER
chmod 0755 "$STAGE/bin/she-companion"

tar -czf "$ARCHIVE" -C "$OUT_DIR" "she-companion-$VERSION"
node scripts/companion-release-manifest.mjs --root "$ROOT" --bundle "$ARCHIVE" --out "$OUT_DIR/companion-release-manifest.json"
echo
echo "Built companion bundle:"
ls -lh "$ARCHIVE"
sha256sum "$ARCHIVE"
