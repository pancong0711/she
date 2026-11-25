#!/usr/bin/env bash
# Stable core-bundle entrypoint used by she-companion.
# The companion calls this path; it must not hardcode internal CLI entrypoints.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$ROOT/run-core.mjs" "$@"
