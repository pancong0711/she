# Sandbox 镜像获取与受限网络 fallback 实测

> 日期：2026-11-27
> 状态：已实测；本地 rootfs 构建路线可重复
> 关联：`docs/SANDBOX-IMAGES.md`、`scripts/build-sandbox-fallback-image.sh`

## 1. 结论

在 Docker Hub 直连不可用、多个镜像代理也不稳定的网络环境中，不能只依赖
`docker pull`。可行的多层方案是：

```text
本地已有镜像
  → 官方 Docker Hub
  → 已验证的 registry 代理（public.ecr.aws / 1Panel / 1ms 等）
  → Ubuntu base rootfs 下载 + docker import
  → 本地 Dockerfile 安装 Node/npm/pnpm，生成 she-sandbox-node:24.04
```

其中最后一条已经完整实测：

- Ubuntu 24.04 base rootfs 从清华 TUNA 下载，SHA-256 校验通过；
- `docker import` 成功；
- 在本地构建镜像时使用 TUNA APT 镜像；
- Node v24.11.1 从 npmmirror 下载，SHA-256 校验通过；
- 在 fallback 镜像内安装 `@opencode/cli@2.4.2` 成功，使用 npmmirror；
- 生成的镜像可用于 SHE sandbox，绕过 Docker Hub 和 registry 代理。

## 2. 实测矩阵

测试环境：rootless Docker 29.1.3，Linux x86_64，当前网络无法直连
`registry-1.docker.io`。

| 路线 | 命令/来源 | 结果 | 备注 |
|---|---|---|---|
| Docker Hub 直连 | `docker pull ubuntu:24.04` | ❌ | `registry-1.docker.io:443 i/o timeout` |
| 1Panel Ubuntu | `docker.1panel.live/library/ubuntu:24.04` | ✅ | 119MB，能完成；首次尝试可能超过 100 秒 |
| 1ms.run Ubuntu | `docker.1ms.run/library/ubuntu:24.04` | ⚠️ | 100 秒内未完成，需更长观察 |
| 轩辕 Ubuntu | `docker.xuanyuan.me/library/ubuntu:24.04` | ❌ | 403 Forbidden |
| DaoCloud Ubuntu | `docker.m.daocloud.io/library/ubuntu:24.04` | ❌ | DNS/匿名 token 超时 |
| dockerproxy.net | `dockerproxy.net/library/ubuntu:24.04` | ❌ | manifest 请求超时 |
| AWS ECR Public Ubuntu | `public.ecr.aws/docker/library/ubuntu:24.04` | ✅ | 快速完成 |
| AWS ECR Public Node | `public.ecr.aws/docker/library/node:24-bookworm` | ❌ | 多个大层未完成，连接被 reset |
| 1Panel Node | `docker.1panel.live/library/node:24-bookworm` | ⚠️ | 大镜像拉取时间长，测试中未在单次窗口完成 |
| TUNA rootfs + import | `ubuntu-base-24.04.5-base-amd64.tar.gz` | ✅ | 28.6MB，下载约 1 秒，import 约 1 秒 |
| 本地 fallback 镜像 | `scripts/build-sandbox-fallback-image.sh` | ✅ | TUNA APT + npmmirror Node v24.11.1 + pnpm |
| fallback 镜像内安装 OpenCode | `@opencode/cli@2.4.2` | ✅ | npm registry=npmmirror，约 7 秒，`opencode v2.4.2` |

镜像代理的可用性会随时间、地区和网络运营商变化，不能把某一个代理写死为唯一
来源。

## 3. 推荐的 fallback 构建路线

执行：

```sh
pnpm sandbox:fallback-image
# 或
bash scripts/build-sandbox-fallback-image.sh
```

默认输出：

```text
she-sandbox-node:24.04
```

脚本流程：

```text
TUNA ubuntu-base rootfs（SHA-256 校验）
  → docker import
  → TUNA Ubuntu APT 源
  → 安装 ca-certificates/curl/xz-utils/git
  → npmmirror 下载 Node v24.11.1（SHA-256 校验）
  → 安装 pnpm@10
  → tag 为 she-sandbox-node:24.04
```

可在 SHE 中把镜像设为：

```text
she-sandbox-node:24.04
```

镜像源选择 `official`，因为镜像已经在本机，不需要 registry 拉取。Agent 安装会
在容器内使用 `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com/`。

### 3.1 可覆盖参数

```sh
SHE_SANDBOX_IMAGE=she-sandbox-node:24.04 \
SHE_NODE_VERSION=v24.11.1 \
SHE_NODE_MIRROR=https://npmmirror.com/mirrors/node \
SHE_UBUNTU_APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/ubuntu \
pnpm sandbox:fallback-image
```

## 4. 直接使用 Ubuntu rootfs 的简化路线

如果只需要 Ubuntu 环境，不需要 Node：

```sh
curl -fL --retry 3 -o ubuntu-base.tar.gz \
  'https://mirrors.tuna.tsinghua.edu.cn/ubuntu-cdimage/ubuntu-base/releases/24.04/release/ubuntu-base-24.04.5-base-amd64.tar.gz'
sha256sum ubuntu-base.tar.gz
docker import ubuntu-base.tar.gz she-ubuntu-base:24.04
docker run --rm she-ubuntu-base:24.04 sh -lc 'cat /etc/os-release'
```

但 Agent recipe 需要 Node/npm，因此 SHE 的默认 fallback 应使用
`she-sandbox-node:24.04`，而不是裸 Ubuntu base。

## 5. 安全与可重复性

- 所有 rootfs/Node 下载都做 SHA-256 校验；
- APT 包通过 Ubuntu 镜像站和 rootfs 内 apt keyring 校验；
- 第三方 Docker registry 代理可能缓存或改变内容，不建议作为敏感环境的唯一来源；
- 镜像代理不是安全边界，生产环境应尽量锁定 digest 或使用自建 registry；
- 本地构建是可重复的，但依赖 TUNA/npmmirror 的当前网络可用性；
- 本脚本只支持当前宿主机架构；跨架构需要对应 `amd64`/`arm64` rootfs 和 Node tarball。

## 6. 当前未自动化的部分

本次先完成测试和脚本，不在 PWA 中自动触发镜像构建。后续可增加：

1. Sandboxes 页面检测本地是否存在 `she-sandbox-node:24.04`；
2. “构建本地 fallback 镜像”任务与实时日志；
3. 镜像源失败时自动提示 fallback；
4. 在 Packages 页面显示 fallback 镜像版本、Node 版本和构建时间。
