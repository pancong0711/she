#!/usr/bin/env bash
# Build and pack the public SHE packages used by gateway adapters.
#
# Usage:
#   bash scripts/pack-packages.sh [output-dir]
#
# Environment:
#   OUT_DIR  Optional output directory; default: <repo>/artifacts/packages
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${OUT_DIR:-$ROOT/artifacts/packages}}"

cd "$ROOT"
pnpm build
mkdir -p "$OUT_DIR"

pnpm --filter @she/protocol pack --pack-destination "$OUT_DIR"
pnpm --filter @she/client pack --pack-destination "$OUT_DIR"

echo
echo "Packed public packages:"
ls -1 "$OUT_DIR"/*.tgz
echo
echo "SHA-256:"
sha256sum "$OUT_DIR"/*.tgz
