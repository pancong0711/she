#!/usr/bin/env bash
# Build a self-contained SHE core bundle for she-companion.
#
# Usage:
#   bash scripts/build-core-bundle.sh [output-dir]
#
# Output:
#   <out>/she-core-<version>/          # unpacked bundle
#   <out>/she-core-<version>.tar.gz    # release bundle
#   <out>/release-manifest.json        # manifest with SHA-256
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${OUT_DIR:-$ROOT/artifacts/core}}"
VERSION="$(node -e "process.stdout.write(require('$ROOT/package.json').version)")"
STAGE="$OUT_DIR/she-core-$VERSION"
ARCHIVE="$OUT_DIR/she-core-$VERSION.tar.gz"

cd "$ROOT"
pnpm build
rm -rf "$STAGE" "$ARCHIVE"
mkdir -p "$STAGE"

pnpm exec esbuild apps/control-plane/src/main.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --outfile="$STAGE/control-plane.mjs"

pnpm exec esbuild apps/broker/src/main.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --outfile="$STAGE/broker.mjs"

cp run-core.mjs run-core.sh run-core.cmd LICENSE "$STAGE/"
printf '%s\n' "$VERSION" > "$STAGE/VERSION"
node -e "const fs=require('fs'); const p=process.argv[1]; fs.writeFileSync(process.argv[2], JSON.stringify({schema:1,name:'she-core',version:process.argv[3],entrypoint:{posix:'run-core.sh',windows:'run-core.cmd'}},null,2)+'\n')" "$ROOT/package.json" "$STAGE/bundle.json" "$VERSION"
chmod 0755 "$STAGE/run-core.sh" "$STAGE/run-core.mjs"

tar -czf "$ARCHIVE" -C "$OUT_DIR" "she-core-$VERSION"
node scripts/release-manifest.mjs --root "$ROOT" --bundle "$ARCHIVE" --out "$OUT_DIR/release-manifest.json"

echo
echo "Built core bundle:"
ls -lh "$ARCHIVE" "$STAGE" | sed -n '1,80p'
echo
echo "SHA-256:"
sha256sum "$ARCHIVE"
