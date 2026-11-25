#!/bin/bash
set -euo pipefail
TMP="$(mktemp -t she-start.XXXXXX.sh)"
trap 'rm -f "$TMP"' EXIT
curl -fL --retry 3 --connect-timeout 20 --max-time 120 -o "$TMP" "https://pancong0711.github.io/she/start.sh"
chmod +x "$TMP"
exec bash "$TMP"
