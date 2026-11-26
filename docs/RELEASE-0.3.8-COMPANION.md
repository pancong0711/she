# SHE companion 0.3.8 发布说明

> Release：`v0.3.8-companion.1`
> 日期：2026-11-26

## 变更

- Docker rootless 指引明确解释 subordinate UID/GID：
  - 它是 user namespace 的 UID/GID 映射池；
  - 不是普通登录用户，也不是 root；
  - Ubuntu 新建用户通常已自动分配；
  - 先 `grep` 检查，只有没有输出时才执行 `usermod --add-subuids`。
- Packages 页面同步显示条件说明和常见 Ubuntu 情况。

## 其他

- 保留 0.3.6/0.3.7 的 Core `--force` 重装、回滚、外部 Core 接管、SQLite 父目录创建修复。
