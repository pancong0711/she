#!/usr/bin/env bash
# Build a local Node-enabled sandbox image without pulling from Docker Hub.
#
# Route:
#   TUNA ubuntu-base rootfs -> docker import -> local Ubuntu base
#     + TUNA apt mirror (git/curl/ca-certificates/xz)
#     + npmmirror Node binary tarball (SHA-256 verified)
#     + npmmirror npm registry + pnpm
#   -> she-sandbox-node:<ubuntu-version>
#
# This is a last-resort backup for networks where Docker Hub and its common
# registry mirrors are unavailable. All downloads are checksum-verified.
set -euo pipefail

DOCKER="${SHE_DOCKER_BIN:-docker}"
UBUNTU_SERIES="${SHE_UBUNTU_SERIES:-24.04}"
UBUNTU_BASE_MIRROR="${SHE_UBUNTU_BASE_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/ubuntu-cdimage/ubuntu-base/releases/${UBUNTU_SERIES}/release}"
UBUNTU_APT_MIRROR="${SHE_UBUNTU_APT_MIRROR:-http://mirrors.tuna.tsinghua.edu.cn/ubuntu}"
NODE_MIRROR="${SHE_NODE_MIRROR:-https://npmmirror.com/mirrors/node}"
NODE_VERSION="${SHE_NODE_VERSION:-v24.11.1}"
NODE_REGISTRY="${SHE_NPM_REGISTRY:-https://registry.npmmirror.com/}"
IMAGE="${SHE_SANDBOX_IMAGE:-she-sandbox-node:${UBUNTU_SERIES}}"
BASE_TAG="she-local-ubuntu-base:${UBUNTU_SERIES}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/she-sandbox-image.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

case "$(uname -m)" in
  x86_64|amd64) UBUNTU_ARCH=amd64; NODE_ARCH=x64 ;;
  aarch64|arm64) UBUNTU_ARCH=arm64; NODE_ARCH=arm64 ;;
  *) echo "✗ unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

command -v "$DOCKER" >/dev/null 2>&1 || { echo "✗ docker is required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "✗ curl is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "✗ sha256sum is required" >&2; exit 1; }

echo "[1/5] resolve latest Ubuntu ${UBUNTU_SERIES} base rootfs"
SUMS="$(curl -fsSL --retry 3 --connect-timeout 20 --max-time 60 "$UBUNTU_BASE_MIRROR/SHA256SUMS")"
LINE="$(printf '%s\n' "$SUMS" | grep -E "ubuntu-base-${UBUNTU_SERIES//./\\.}\.[0-9]+-base-${UBUNTU_ARCH}\.tar\.gz" | sort -V | tail -n1)"
[ -n "$LINE" ] || { echo "✗ no ubuntu-base rootfs found for ${UBUNTU_ARCH}" >&2; exit 1; }
BASE_FILE="${LINE##* }"
BASE_SHA="${LINE%% *}"
BASE_FILE="${BASE_FILE#\*}"
echo "      $BASE_FILE"
echo "      sha256=$BASE_SHA"

echo "[2/5] download and verify Ubuntu base rootfs"
curl -fL --retry 3 --connect-timeout 20 --max-time 300 -o "$WORK/$BASE_FILE" "$UBUNTU_BASE_MIRROR/$BASE_FILE"
echo "$BASE_SHA  $WORK/$BASE_FILE" | sha256sum -c -

echo "[3/5] import rootfs into local Docker image $BASE_TAG"
"$DOCKER" import "$WORK/$BASE_FILE" "$BASE_TAG"

echo "[4/5] resolve Node ${NODE_VERSION} checksum"
NODE_FILE="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
NODE_SUMS="$(curl -fsSL --retry 3 --connect-timeout 20 --max-time 60 "$NODE_MIRROR/$NODE_VERSION/SHASUMS256.txt")"
NODE_SHA="$(printf '%s\n' "$NODE_SUMS" | awk -v file="$NODE_FILE" '$2 == file || $2 == "*" file { print $1; exit }')"
[ -n "$NODE_SHA" ] || { echo "✗ Node checksum not found for $NODE_FILE" >&2; exit 1; }
echo "      $NODE_FILE"
echo "      sha256=$NODE_SHA"

echo "[5/5] build $IMAGE (TUNA apt + npmmirror Node/npm/pnpm)"
cat > "$WORK/Dockerfile" <<'DOCKERFILE'
FROM __BASE_IMAGE__
ARG APT_MIRROR
ARG NODE_VERSION
ARG NODE_FILE
ARG NODE_SHA256
ARG NODE_MIRROR
ARG NODE_REGISTRY
ENV DEBIAN_FRONTEND=noninteractive
RUN sed -i "s|http://archive.ubuntu.com/ubuntu/|${APT_MIRROR}/|g; s|http://security.ubuntu.com/ubuntu/|${APT_MIRROR}/|g" /etc/apt/sources.list.d/ubuntu.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils git \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 3 --connect-timeout 20 --max-time 300 -o /tmp/node.tar.xz "${NODE_MIRROR}/${NODE_VERSION}/${NODE_FILE}" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.xz \
 && npm config set registry "${NODE_REGISTRY}" \
 && npm install --global pnpm@10 --registry="${NODE_REGISTRY}" \
 && node --version && npm --version && pnpm --version
DOCKERFILE
sed -i "s|__BASE_IMAGE__|$BASE_TAG|" "$WORK/Dockerfile"
"$DOCKER" build --pull=false \
  --build-arg "APT_MIRROR=$UBUNTU_APT_MIRROR" \
  --build-arg "NODE_VERSION=$NODE_VERSION" \
  --build-arg "NODE_FILE=$NODE_FILE" \
  --build-arg "NODE_SHA256=$NODE_SHA" \
  --build-arg "NODE_MIRROR=$NODE_MIRROR" \
  --build-arg "NODE_REGISTRY=$NODE_REGISTRY" \
  -t "$IMAGE" "$WORK"

echo
echo "✓ local fallback image ready: $IMAGE"
"$DOCKER" run --rm "$IMAGE" sh -lc 'node --version; npm --version; pnpm --version; npm config get registry'
echo "Use it as a custom sandbox image. In SHE choose image source=official (the image is already local)."
