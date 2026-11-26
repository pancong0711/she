# SHE companion 0.4.7 发布说明

> Release：`v0.4.7-companion.1`
> 日期：2026-11-26

## 新增

- Sandboxes 页面支持创建 sandbox：
  - 名称/角色/agentId；
  - 镜像预设与自定义；
  - egress/none；
  - 启动命令；
  - CPU/memory/PIDs；
  - 调用 broker `POST /v1/sandboxes`。
- Agent Migration 镜像改为 Packages Sandbox 预设下拉 + 自定义覆盖。
- 增加容器设置逐项解释：
  - 镜像与 agent runtime；
  - 启动命令；
  - egress 只表示 bridge 出网；
  - 资源建议；
  - `/legacy` 与凭据只读挂载。
- 新增 `docs/SANDBOXES.md`。

## 说明

- SHE 仍不会猜测 npm/PyPI agent 包名并自动安装；
- 默认 `sleep infinity` 只保持容器运行；
- 自动安装应通过后续受审计的 Agent Runtime Recipe 实现。
