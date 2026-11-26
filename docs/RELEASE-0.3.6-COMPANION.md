# SHE companion 0.3.6 发布说明

> Release：`v0.3.6-companion.1`
> 日期：2026-11-26

## 修复

- Core 更新安装时增加 `--force`，解决：
  ```text
  version already installed
  ```
  导致 current 未切换、更新失败的问题；
- 安装失败时自动回滚到 previous core；
- 检测外部运行的 core（外部进程仍占用 control socket）；
- 停止/重启外部 core 时调用受认证的 `/v1/admin/shutdown`；
- Core 卡片显示外部 core warning 和操作反馈；
- 默认 Core manifest 指向 0.2.1。

## Core 首次安装

`start.sh` 仍然只安装/启动 companion，不自动安装 Core。首次使用需要在页面点击「安装 Core」；这是为了避免未经确认的下载和运行时替换。

## 升级

已有 0.3.x supervisor 用户可在 Settings 中检查并安装 0.3.6，然后通过 Core 更新安装 0.2.1。
