# SHE core 0.3.1 发布说明

> Release：`v0.3.1-core.1`
> 日期：2026-11-27

## 修复

- 修复 broker 生成 Docker bind mount 参数时的非法 `rw` 字段：
  - 读写：`type=bind,src=...,dst=...`
  - 只读：`type=bind,src=...,dst=...,readonly`
- 新增纯函数 `buildDockerRunArgs()`，在不连接 Docker 的情况下回归测试完整
  `docker run` argv。
- sandbox 本地临时工作目录改为 `scratch/`，与用户项目 workspace 明确分离。
- protocol 注释明确：未提供 workspace host mount 时，`/workspace` 是
  sandbox-local scratch。

## 验证

```text
pnpm typecheck ✓
pnpm test      ✓ 104/104
pnpm build:core ✓
```
