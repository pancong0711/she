# SHE companion 0.3.9 发布说明

> Release：`v0.3.9-companion.1`
> 日期：2026-11-26

## 变更

Docker rootless 指引改为 Debian/Ubuntu 官方 apt 包路径：

```bash
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras \
  uidmap dbus-user-session fuse-overlayfs slirp4netns
```

随后：

```bash
dockerd-rootless-setuptool.sh install
systemctl --user enable --now docker
docker context use rootless
docker info --format '{{json .SecurityOptions}}'
```

说明：

- 不再要求用户必须执行 `curl | sh`；
- 仍然不会把用户加入 root docker 组；
- subuid/subgid 先检查，Ubuntu 通常已自动分配，缺失时才需要 `usermod`；
- 可选择禁用系统 root Docker daemon，避免误用。
