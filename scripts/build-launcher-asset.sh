#!/usr/bin/env bash
# Build the standalone companion launcher used by the Pages channel mirror.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/apps/pwa/public/she-launcher.mjs}"
mkdir -p "$(dirname "$OUT")"
cd "$ROOT"
if [ -x "$ROOT/node_modules/.bin/esbuild" ]; then
  ESBUILD="$ROOT/node_modules/.bin/esbuild"
else
  ESBUILD="pnpm exec esbuild"
fi
$ESBUILD apps/companion/launcher.mjs \
  --bundle --platform=node --format=esm --target=node22 \
  --outfile="$OUT"
node --check "$OUT"
chmod 0755 "$OUT"
