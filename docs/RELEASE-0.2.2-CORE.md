# SHE core 0.2.2 发布说明

> Release：`v0.2.2-core.1`
> 日期：2026-11-26

## 修复

- 修复 core 启动报错：
  ```text
  unable to open database file
  const db = new DatabaseSync(path)
  ```
- `SqliteStore.open()` 现在会：
  - 自动创建 database 父目录（0700）；
  - 创建数据库文件后设置 0600；
  - 保持 `:memory:` 行为不变。

## 原因

Core 默认 DB 路径为：

```text
$XDG_STATE_HOME/she/she.db
回退 ~/.local/state/she/she.db
```

如果父目录不存在，`DatabaseSync` 不会自动递归创建目录，直接启动失败。首次安装、用户级环境变化或切换 XDG 目录时容易触发。

## 验证

- 嵌套不存在目录可打开 SQLite；
- DB 文件权限 0600；
- migrations 仍为 v2；
- core bundle 启动成功。
