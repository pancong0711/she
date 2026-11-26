# SHE companion 0.4.3 发布说明

> Release：`v0.4.3-companion.1`
> 日期：2026-11-26

## 界面修复

- 环境能力摘要：
  - 新增“重新检查环境”；
  - 新增“仅刷新结果”；
  - 接口失败时清空旧结果并显示错误；
  - 显示 last checked 时间。
- Core 操作：
  - 启动/停止/重启立即显示等待说明；
  - 前端 30 秒超时；
  - 外部 Core warning 与操作结果保持可见。
- Docker：
  - Packages Docker 卡片新增安装源下拉；
  - 官方源、阿里云、TUNA、USTC 步骤随下拉切换；
  - 复制命令复制当前选中的安装源。
- Chat：
  - 明确提示当前只有单 OpenCode worker，多 agent 路由尚未启用。

## 保留

- Core 0.2.2 SQLite 父目录修复；
- Companion 0.4.1 socket-owner fallback；
- Sandbox 镜像默认配置。
