# SHE companion 0.3.2 发布说明

> Release：`v0.3.2-companion.1`
> 日期：2026-11-26

## 新增

- Settings 用户级登录自启动：
  - Linux systemd --user；
  - Linux XDG autostart fallback；
  - macOS LaunchAgent；
  - Windows Startup 文件夹；
- 安装版 companion 自动识别 `sourceCheckout=false`：
  - 隐藏源码“安装依赖/构建/测试”工具；
  - 服务端阻断这些 job，避免误点击后 exit 1；
- Docker 安装指引按发行版生成：
  - Ubuntu；
  - Debian；
  - Fedora；
  - Arch；
  - macOS/Windows Docker Desktop；
- 明确 Docker 不是 core 启动硬依赖。

## 使用

已有 0.3.x supervisor 的用户可在 Settings 检查并安装 0.3.2。旧 0.2.x 用户仍需先用 start.sh 升级一次。

## 边界

- 自启动是用户级机制，不是系统级 service；
- 不执行 sudo、不请求 root；
- Linux 未登录启动需要 linger，需用户本人/管理员配置；
- Windows/macOS 自启动尚未真机验收。
