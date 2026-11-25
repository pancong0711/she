#!/usr/bin/env bash
# User-level SHE bootstrap. Never uses sudo and never installs Docker/rootless.
#
# Usage:
#   bash scripts/bootstrap-user.sh --check
#   bash scripts/bootstrap-user.sh --install-pnpm
#   bash scripts/bootstrap-user.sh --install-deps
#
# Node.js itself is not installed automatically. If missing, this script prints
# platform-appropriate guidance and exits; it does not request admin rights.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="check"
case "${1:-}" in
  --check|"") MODE="check" ;;
  --install-pnpm|--install) MODE="install-pnpm" ;;
  --install-deps) MODE="install-deps" ;;
  -h|--help)
    sed -n '2,12p' "$0"
    exit 0
    ;;
  *)
    echo "usage: $0 [--check|--install-pnpm|--install-deps]" >&2
    exit 2
    ;;
esac

if [ "$(id -u)" = "0" ]; then
  echo "✗ SHE bootstrap must not run as root. Re-run as your normal desktop user." >&2
  exit 1
fi

PKG_PNPM="pnpm@11.22.0"
if [ -f package.json ] && command -v node >/dev/null 2>&1; then
  PKG_PNPM="$(node -e "const p=require('./package.json'); process.stdout.write(String(p.packageManager||'pnpm@11.22.0'))" 2>/dev/null || printf '%s' "$PKG_PNPM")"
fi
PNPM_VERSION="${PKG_PNPM#pnpm@}"
export PATH="$HOME/.local/bin:$PATH"

ok() { printf '✓ %s\n' "$*"; }
warn() { printf '! %s\n' "$*"; }
bad() { printf '✗ %s\n' "$*"; }

NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version 2>/dev/null || true)"
  if node -e "const v=process.versions.node.split('.').map(Number); process.exit((v[0]>=24 || (v[0]===22 && v[1]>=19))?0:1)" 2>/dev/null; then
    NODE_OK=1
    ok "Node.js $NODE_VERSION (satisfies ^22.19.0 || >=24.0.0)"
  else
    bad "Node.js ${NODE_VERSION:-unknown} is too old; need ^22.19.0 || >=24.0.0"
  fi
else
  bad "Node.js not found; need ^22.19.0 || >=24.0.0"
fi

PNPM_OK=0
PNPM_CMD="$(command -v pnpm 2>/dev/null || true)"
if [ -n "$PNPM_CMD" ]; then
  PNPM_VERSION_FOUND="$(pnpm --version 2>/dev/null || true)"
  if [ "$PNPM_VERSION_FOUND" = "$PNPM_VERSION" ]; then
    PNPM_OK=1
    ok "pnpm $PNPM_VERSION_FOUND matches packageManager"
  else
    warn "pnpm ${PNPM_VERSION_FOUND:-unknown} found; expected $PNPM_VERSION"
  fi
else
  bad "pnpm not found"
fi

if command -v npm >/dev/null 2>&1; then ok "npm $(npm --version 2>/dev/null || echo unknown)"; else warn "npm not found"; fi
if command -v corepack >/dev/null 2>&1; then ok "corepack $(corepack --version 2>/dev/null || echo unknown)"; else warn "corepack not found"; fi
if command -v git >/dev/null 2>&1; then ok "$(git --version)"; else warn "git not found; clone/update will require manual setup"; fi
if command -v docker >/dev/null 2>&1; then
  if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then
    ok "rootless Docker runtime detected"
  else
    warn "Docker accessible but rootless not detected; it may be root-equivalent. SHE does not request or execute root."
  fi
else
  warn "Docker not found; sandbox features unavailable until the user installs/configures a runtime. SHE will not request root."
fi

if [ "$NODE_OK" -ne 1 ]; then
  echo
  echo "下一步：请由你本人安装 Node.js 22.19+ 或 24+。"
  echo "SHE 不会自动安装 Node，也不会请求 sudo。"
  echo "Linux/macOS 可参考：nvm / fnm / 官方 Node 二进制或组织规范。"
  exit 1
fi

if [ "$MODE" = "install-pnpm" ] && [ "$PNPM_OK" -ne 1 ]; then
  echo "尝试用户级安装 $PKG_PNPM（不请求 root）..."
  if command -v corepack >/dev/null 2>&1; then
    corepack prepare "$PKG_PNPM" --activate 2>/dev/null || true
    corepack enable --install-directory "$HOME/.local/bin" 2>/dev/null || true
  fi
  if ! command -v pnpm >/dev/null 2>&1 || [ "$(pnpm --version 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
    if command -v npm >/dev/null 2>&1; then
      npm install --global --prefix "$HOME/.local" "$PKG_PNPM"
      export PATH="$HOME/.local/bin:$PATH"
    else
      bad "npm unavailable; cannot install pnpm without a package manager"
      exit 1
    fi
  fi
  if command -v pnpm >/dev/null 2>&1; then
    ok "pnpm $(pnpm --version) installed to user prefix"
    echo "注意：请把 $HOME/.local/bin 加入 PATH，或重新登录 shell。"
  else
    bad "pnpm installation did not produce a usable binary"
    exit 1
  fi
fi

if [ "$MODE" = "install-deps" ]; then
  if [ "$PNPM_OK" -ne 1 ]; then
    bad "pnpm is not ready; run --install-pnpm first"
    exit 1
  fi
  echo "安装仓库依赖（用户级）..."
  pnpm install --frozen-lockfile
  ok "dependencies installed"
fi

echo
if [ "$MODE" = "check" ]; then
  echo "检查完成。"
  echo "如需用户级安装 pnpm：bash scripts/bootstrap-user.sh --install-pnpm"
  echo "如需安装仓库依赖：bash scripts/bootstrap-user.sh --install-deps"
fi
