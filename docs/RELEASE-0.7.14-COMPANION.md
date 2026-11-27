# SHE companion 0.7.14（SHE App Shell）发布说明

> Release：`v0.7.14-companion.1`
> 日期：2026-11-27

## 修复

- 修复新 `SHE_HOME` 安装时 bin 目录选择错误：当 `~/.local/bin` 已存在时，
  新安装曾错误尝试写入旧 bin 目录（在只读/受限环境下会失败）。
- 新安装固定使用 `SHE_HOME/bin`；只有运行 legacy `SHE_HOME/companion` 安装时才
  保持旧 `${HOME}/.local/bin` 兼容。
- 同时生成 `she` 与 `she-companion` 两个用户命令；`she` 是新的稳定 App 命令。
- start 脚本与 launcher/path resolver 使用同一 bin 选择规则。

## 兼容

- 0.7.13 的 SHE_HOME、Pages-first core channel、legacy Feishu gateway 标记、
  旧布局迁移 API/CLI 均保留；
- Core 版本保持 0.3.4。
