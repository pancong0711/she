# Docker 安装方法（由用户本人执行）

> 状态：v1
> 代码：`apps/companion/docker-install.mjs`
> 原则：SHE 不执行 sudo，不请求 root，不自动安装 Docker。

## 1. Docker 与 Core 的关系

没有 Docker 时：

- `she-companion` 可以启动；
- `she-core` 的 control-plane 可以启动；
- Tasks、Chat（worker 直接 workspace 模式）可以工作；
- broker 会处于 degraded / Docker unavailable 状态；
- Sandbox、Sandbox 容器、Agent Migration 不可用。

因此 Docker 不是 core 启动的硬依赖，而是 **sandbox/broker 容器能力依赖**。

## 2. Companion 页面中的安装命令

Packages 页面会读取当前平台的 Docker 安装方法：

- Ubuntu：官方 apt repository 完整命令；
- Debian：官方 apt repository 完整命令；
- Fedora：dnf repository 命令；
- Arch：pacman 命令；
- macOS/Windows：Docker Desktop 方法；
- 未知发行版：官方文档 + 验证命令。

可复制命令块，但不会自动执行。

## 3. Ubuntu 示例

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

退出并重新登录后：

```bash
docker version
```

注意：`docker` 组权限可能是 root-equivalent。SHE 不会把它宣称为 rootless。

## 4. Rootless Docker

如果你不希望使用 docker 组 root-equivalent 权限，请按 Docker 官方 rootless 文档由本人安装和配置：

https://docs.docker.com/engine/security/rootless/

SHE 只检测 rootless 状态，不自动配置。

## 5. 验证

```bash
docker version
docker info --format '{{json .SecurityOptions}}'
```

如果包含 `rootless`，Packages 会显示 `ready-rootless`；否则显示 accessible + root-equivalent risk。
