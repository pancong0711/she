# Rootless Docker 安装方法（由用户本人执行）

> 状态：v2（rootless-first）
> 代码：`apps/companion/docker-install.mjs`
> 原则：SHE 不执行 sudo、不请求 root、不自动安装 Docker。

## 1. 结论

推荐并默认展示 **rootless Docker**。

不要把当前用户加入 root Docker 组：

```bash
# 不推荐
sudo usermod -aG docker "$USER"
```

`docker` 组通常可以控制 root Docker daemon，权限可能等价于 root。SHE 不会把这种配置宣称为安全隔离。

## 2. Docker 与 Core 的关系

没有 Docker 时：

- companion 可以启动；
- core/control-plane 可以启动；
- Tasks、Chat worker 直接 workspace 模式可用；
- broker 为 degraded；
- Sandbox、Agent Migration 不可用。

Docker 是 sandbox/broker 容器能力依赖，不是 core 启动硬依赖。

## 2.1 subordinate UID/GID 是什么

Linux 容器里可能有多个用户：

```text
root
daemon
www-data
...
```

rootless Docker 不能真的在宿主机上使用 root，而是通过 **user namespace** 把这些容器内 UID/GID 映射到当前普通用户拥有的一段“备用 UID/GID”上。

这段备用范围就是 subordinate UID/GID：

```text
/etc/subuid: user:100000:65536
/etc/subgid: user:100000:65536
```

含义：

- `user`：宿主用户名；
- `100000`：范围起点；
- `65536`：可用 ID 数量。

它们不是普通登录用户，也不会出现在 `who` 中；只是 user namespace 的映射池。`newuidmap` / `newgidmap`（来自 `uidmap` 包）负责安全地建立映射。

### Ubuntu 是否已经自动配置

很多 Ubuntu 系统在创建用户时已经自动分配了 subordinate UID/GID。先检查：

```bash
grep -E "^$USER:" /etc/subuid /etc/subgid
```

如果看到类似：

```text
/etc/subuid:user:100000:65536
/etc/subgid:user:100000:65536
```

就**不需要**再执行 `usermod --add-subuids`。

只有没有输出时才执行：

```bash
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$USER"
```

然后退出并重新登录。

所以“管理员直接安装 Docker”在两种情况下不同：

- root Docker：daemon 以 root 运行，不需要 subordinate UID/GID，但用户要么使用 sudo，要么加入 docker 组；
- rootless Docker：daemon 以普通用户运行，需要 user namespace/subuid/subgid，很多 Ubuntu 已自动配置，所以用户通常“感觉不到”这一步。

## 3. Ubuntu/Debian：通过 apt 安装 rootless Docker

推荐使用 Docker 官方 apt 仓库安装 `docker-ce-rootless-extras`，而不是必须使用 `curl | sh`。

### 3.1 添加 Docker 官方 apt 仓库

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
```

Debian 将 `ubuntu` 替换为 `debian`，仓库行使用 `$VERSION_CODENAME`。

### 3.2 安装 rootless 包

```bash
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras uidmap dbus-user-session fuse-overlayfs slirp4netns
```

- `docker-ce-rootless-extras` 是 Docker 官方 rootless 支持包；
- `uidmap` 提供 `newuidmap` / `newgidmap`；
- `slirp4netns` 和 `fuse-overlayfs` 提供 rootless 网络和文件系统支持；
- 不需要把用户加入 `docker` 组。

如果只想使用 rootless Docker，可选禁用系统 root daemon：

```bash
sudo systemctl disable --now docker.service docker.socket
```

已有 root Docker 用途时跳过这一步。

### 3.3 检查 subuid/subgid 是否已存在

```bash
grep -E "^$USER:" /etc/subuid /etc/subgid
```

Ubuntu 新用户通常已经自动拥有类似：

```text
/etc/subuid:user:100000:65536
/etc/subgid:user:100000:65536
```

有输出就**不需要**手动配置。

只有没有输出时才执行：

```bash
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$USER"
```

然后退出并重新登录。该范围是 user namespace 的 UID/GID 映射池，不是 root 权限。

### 3.4 初始化用户级 rootless daemon

```bash
dockerd-rootless-setuptool.sh install
systemctl --user enable --now docker
docker context use rootless
docker info --format '{{json .SecurityOptions}}'
```

输出应包含：

```text
rootless
```

可选未登录运行：

```bash
sudo loginctl enable-linger "$USER"
```

需要管理员权限，SHE 不代你执行。

## 4. Fedora / Arch

Fedora 依赖：

```bash
sudo dnf install -y shadow-utils fuse-overlayfs slirp4netns
```

Arch 依赖：

```bash
sudo pacman -S --needed uidmap fuse-overlayfs slirp4netns
```

随后同样使用 Docker 官方 rootless 安装脚本和 `dockerd-rootless-setuptool.sh`。

## 5. macOS / Windows

使用 Docker Desktop：

- macOS：Docker Desktop 使用 VM，不要求加入 root docker 组；
- Windows：Docker Desktop + WSL2 backend，不要求加入 root docker 组。

## 6. 验证

```bash
docker context use rootless
docker info --format '{{json .SecurityOptions}}'
```

输出应包含：

```text
rootless
```

## 7. Packages 页面

Docker 卡片会显示：

- 每一步命令；
- 该命令做什么；
- 是否需要管理员权限；
- 是否可选；
- 复制全部命令按钮；
- Docker 官方 rootless 文档链接。

命令只展示，不自动执行。


## 7.1 Packages 安装源下拉

Docker 卡片提供安装源下拉：

- Docker 官方源；
- 阿里云 Docker CE 镜像；
- 清华 TUNA Docker CE 镜像；
- 中科大 USTC Docker CE 镜像。

切换后步骤和复制命令会同步变化。

## 8. 国内网络备用镜像

如果 `download.docker.com` 出现：

```text
Connection reset by peer
```

可以使用 Docker CE 的国内镜像。

Packages 页面已内置以下备用方案：

- 阿里云 Docker CE 镜像；
- 清华 TUNA Docker CE 镜像；
- 中科大 USTC Docker CE 镜像。

只会替换 apt 仓库和 GPG 下载地址，仍然使用 Docker 官方签名密钥。请检查密钥指纹：

```text
9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88
```

示例：阿里云 Ubuntu 镜像

```bash
sudo curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras uidmap dbus-user-session fuse-overlayfs slirp4netns
```

注意：

- 镜像只解决 apt/GPG 下载问题；
- `docker pull` 拉取镜像仍可能受 Docker Hub 网络影响，需要单独配置 registry mirror；
- 不要为了绕过下载问题加入 root docker 组；
- 镜像源不可信时，必须通过官方密钥指纹校验确认。
