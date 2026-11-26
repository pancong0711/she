# SHE companion 0.3.7 发布说明

> Release：`v0.3.7-companion.1`
> 日期：2026-11-26

## 修复

- Core 更新指向 0.2.2；
- 启动 core 前预创建默认 DB 父目录，避免旧 core 因 `unable to open database file` 无法启动；
- 保留 0.3.6 的 `--force` 重装、安装失败回滚、外部 core 接管和 admin shutdown 逻辑。

## 升级

已有 0.3.x supervisor 用户可在 Settings 中升级到 0.3.7，然后更新 Core 到 0.2.2。
