# SHE companion 0.7.0 发布说明

> Release：`v0.7.0-companion.1`
> 日期：2026-11-26

## 新增

- Agent 版本可手填，并在安装/创建前校验 npm registry：
  - 指定版本存在 → 使用指定版本；
  - 指定版本不存在 → 回退到最新稳定版并提示；
  - registry 不可达 → 使用 recipe 默认版本并标记 unverified。
- OpenCode 内置推荐版本增加 `0.2.4`（默认仍为 recipe 版本）。
- 新增成功安装版本注册表：
  ```text
  ~/.config/she/agent-versions.json（0600）
  ```
  每个 agent 默认保留最近 5 个成功版本。
- Agent 安装目录改为可并存多版本：
  ```text
  /home/agent/.agents/<agent>/<version>/
  /home/agent/.local/bin/<binary> -> current version
  ```
- Sandboxes 创建选择器改为两级：
  - 一级：Agent / 系统镜像；
  - 二级：Agent 版本（可手填）或系统 image。
- Sandboxes 卡片安装面板支持：
  - 手填版本；
  - 校验版本；
  - 安装并验证；
  - 安装成功后写入版本列表。
- 新增 `docs/SANDBOX-LIFECYCLE.md`，明确 stop/start/restart/destroy、升级 Agent 与 workspace 的关系。

## 说明

- 版本列表只是“成功安装历史”；同一 sandbox 的实际版本目录可以继续保留，切换 current 链接即可。
- 删除 sandbox 与删除 workspace 不是同一件事。destroy 默认保留数据目录。
- Core 版本保持 `0.3.0`。

## 验证

```text
pnpm typecheck  ✓
pnpm test       ✓
pnpm pwa:build  ✓
pnpm build:companion ✓
```
