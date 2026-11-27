#!/usr/bin/env bash
# Build the stable companion distribution bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${OUT_DIR:-$ROOT/artifacts/companion}}"
VERSION="$(node -e "process.stdout.write(require('$ROOT/apps/companion/package.json').version)")"
STAGE="$OUT_DIR/she-companion-$VERSION"
ARCHIVE="$OUT_DIR/she-companion-$VERSION.tar.gz"

cd "$ROOT"
pnpm pwa:build
pnpm --filter @she/feishu-gateway build
rm -rf "$STAGE" "$ARCHIVE"
mkdir -p "$STAGE/apps/companion" "$STAGE/apps/pwa" "$STAGE/apps/feishu-gateway" "$STAGE/scripts" "$STAGE/bin"

cp apps/companion/server.mjs apps/companion/supervisor.mjs apps/companion/launcher.mjs apps/companion/companion-installer.mjs apps/companion/cors.mjs apps/companion/local-agents.mjs apps/companion/preflight.mjs apps/companion/workspaces.mjs apps/companion/companion-update.mjs apps/companion/docker-install.mjs apps/companion/autostart.mjs apps/companion/gateway.mjs apps/companion/feishu4dsh.mjs apps/companion/opencode-service.mjs apps/companion/sandbox-agent-recipes.mjs apps/companion/sandbox-agent-versions.mjs apps/companion/feishu-gateway-manager.mjs apps/companion/core-process.mjs apps/companion/sandbox-preferences.mjs apps/companion/package.json "$STAGE/apps/companion/"
cp apps/feishu-gateway/dist/main.cjs "$STAGE/apps/feishu-gateway/main.cjs"
cp -a apps/pwa/dist "$STAGE/apps/pwa/dist"
cp scripts/bootstrap-user.sh scripts/bootstrap-user.ps1 scripts/install-core-bundle.sh "$STAGE/scripts/"
cp scripts/install-companion.sh scripts/install-companion.ps1 "$STAGE/scripts/"
cp LICENSE README.md "$STAGE/"
pnpm exec esbuild apps/companion/launcher.mjs --bundle --platform=node --format=esm --target=node22 --outfile="$OUT_DIR/she-launcher.mjs"
node --check "$OUT_DIR/she-launcher.mjs"
cp "$OUT_DIR/she-launcher.mjs" "$STAGE/bin/she-launcher.mjs"
chmod 0755 "$STAGE/bin/she-launcher.mjs"
printf '%s\n' "$VERSION" > "$STAGE/VERSION"
cat > "$STAGE/bin/she-companion" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/apps/companion/server.mjs" "$@"
LAUNCHER
chmod 0755 "$STAGE/bin/she-companion"

tar -czf "$ARCHIVE" -C "$OUT_DIR" "she-companion-$VERSION"
node scripts/companion-release-manifest.mjs --root "$ROOT" --bundle "$ARCHIVE" --launcher "$OUT_DIR/she-launcher.mjs" --out "$OUT_DIR/companion-release-manifest.json"
echo
echo "Built companion bundle:"
ls -lh "$ARCHIVE" "$OUT_DIR/she-launcher.mjs"
sha256sum "$ARCHIVE" "$OUT_DIR/she-launcher.mjs"
