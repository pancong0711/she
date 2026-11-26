# SHE companion 0.4.5 发布说明

> Release：`v0.4.5-companion.1`
> 日期：2026-11-26

## 文档/UI

- Docker rootless 安装步骤 12–17 增加详细解释：
  - `dockerd-rootless-setuptool.sh install` 为什么创建 user service/context；
  - `systemctl --user enable --now docker` 控制的是用户级 systemd；
  - `docker context use rootless` 切换到用户 socket；
  - `docker info` 如何验证 rootless；
  - `loginctl enable-linger` 与“无登录运行”的含义；
  - `loginctl show-user -p Linger` 验证。
- 增加远程/无桌面部署说明：
  - rootless Docker 需要 user systemd manager；
  - 默认可能随最后一个登录会话退出；
  - linger 可让 user manager 在无登录时和开机时运行；
  - 手动 SSH 启动的进程仍不等于 systemd service。
