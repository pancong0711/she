# SHE companion 0.3.5 发布说明

> Release：`v0.3.5-companion.1`
> 日期：2026-11-26

## 变更

- Docker 安装指引改为 rootless-first；
- 默认不再建议 `usermod -aG docker`；
- Packages 页面逐行展示 Docker 安装命令和解释；
- 每条步骤标记是否需要管理员权限、是否可选；
- 明确 docker 组可能是 root-equivalent；
- rootless 验证命令：
  ```bash
  docker info --format '{{json .SecurityOptions}}'
  ```
  输出应包含 `rootless`。

## 安全边界

- SHE 不执行 sudo；
- SHE 不请求 root；
- 安装命令只展示，不自动运行；
- 需要管理员权限的步骤由用户本人执行。

## 升级

已有 0.3.x supervisor 的用户可在 Settings 中检查并安装 0.3.5。旧 0.2.x 仍需先用新版 start.sh 升级一次。
