# SHE companion 0.4.2 发布说明

> Release：`v0.4.2-companion.1`
> 日期：2026-11-26

## 新增

- Packages Sandbox 镜像下拉与默认资源配置：
  - Node 22/24、Ubuntu 24.04、Debian 12、Alpine 3.20、Python 3.12；
  - 自定义镜像；
  - 默认网络、CPU、内存、PIDs；
  - 本机 Docker image 检测；
  - `docker pull <image>` 提示。
- Agent Migration 自动读取 Sandbox 默认镜像和资源。
- Packages 卡片等高并支持块内滚动。
- Environment 能力摘要增加“重新检查环境”按钮和接口错误清理。
- Core 启停操作增加等待提示和 30 秒前端超时。
- Chat 明确提示当前只有一个 OpenCode worker，多 agent 路由尚未启用。

## 保留

- Rootless-first Docker apt 安装与国内镜像备用方案；
- Supervisor/外部 Core 接管；
- SQLite 父目录修复；
- Workspaces、Gateway、Artifacts、Autostart。
