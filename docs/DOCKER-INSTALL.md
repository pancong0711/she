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

## 3. Ubuntu/Debian rootless 安装步骤

以下命令由用户本人逐行执行，Packages 页面会逐行解释：

```bash
sudo apt-get update && sudo apt-get install -y uidmap dbus-user-session fuse-overlayfs slirp4netns
grep -E "^$USER:" /etc/subuid /etc/subgid
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$USER"
curl -fsSL https://get.docker.com/rootless | sh
export PATH="$HOME/bin:$PATH"
dockerd-rootless-setuptool.sh install
docker context use rootless
docker info --format '{{json .SecurityOptions}}'
```

逐行说明：

1. 安装 user namespace、slirp4netns 和 fuse-overlayfs 依赖；
2. 检查当前用户是否有 subordinate UID/GID；
3. 没有时分配 subordinate UID/GID（需要管理员操作，重新登录后生效）；
4. 运行 Docker 官方 rootless 安装脚本；
5. 把用户级 Docker 工具加入 PATH；
6. 创建并启动用户级 rootless Docker service；
7. 切换 Docker context；
8. 验证输出包含 `rootless`。

可选：

```bash
systemctl --user enable docker
sudo loginctl enable-linger "$USER"
```

`enable-linger` 用于未登录时运行用户级服务，需要管理员权限；SHE 不代你执行。

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
