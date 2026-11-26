# SHE companion 0.6.0 发布说明

> Release：`v0.6.0-companion.1`
> 日期：2026-11-26

## 重点

SHE 现在是完整的独立 agent control plane，不再要求用户先安装 dsh 或 feishu4dsh 才能连接飞书。

新增 **SHE Built-in Feishu Gateway**：

```text
飞书
  ↕ Lark SDK WebSocket
SHE built-in Feishu gateway
  ↕ @she/client / gateway.v1
SHE control plane
```

- 新增 `apps/feishu-gateway`，直接依赖官方 `@larksuiteoapi/node-sdk`。
- Companion 新增：
  ```text
  GET  /api/feishu/gateway/status
  POST /api/feishu/gateway/config
  POST /api/feishu/gateway/start
  POST /api/feishu/gateway/stop
  ```
- PWA Gateway 页面可直接填写 Feishu App ID / App Secret，并启动/停止连接。
- Secret 保存在 `~/.config/she/feishu.env`（0600）；core/agent 不读取，PWA 不回显。
- 支持：
  - `/she help|list|status|submit|cancel`；
  - command result 文本回传；
  - task accepted/completed/failed；
  - agent text delta 聚合后回传。
- 原有的外部 feishu4dsh adapter 配置保留为高级可选项，不再是默认连接路径。
- 修复 launcher 固定旧 Release tag 的问题：
  - `start.sh` / `start.ps1` 默认使用 `releases/latest/download`；
  - PWA companion 更新检查也改为 latest manifest，避免 PWA build 与本地 companion 版本长期不一致。

## 当前限制

- 内置 gateway 首版以文本为主；卡片审批、表单、文件回传和实时卡片进度待后续实现。
- Gateway 进程由 companion 托管；systemd user service/linger 持久化仍待补。
- Agent worker 本身仍使用宿主侧 OpenCode；sandbox agent 路由是独立后续任务。

## 验证

```text
pnpm typecheck  ✓
pnpm test       ✓ 99/99
pnpm pwa:build  ✓
pnpm build:core ✓
pnpm build:companion ✓
```
