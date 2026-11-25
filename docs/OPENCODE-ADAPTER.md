# OpenCode agent adapter

> 日期：2026-11-25
> 状态：M2 完成（T2.1–T2.4）
> 代码：
> - `packages/adapters/agent-opencode/src/client.ts`
> - `packages/adapters/agent-opencode/src/adapter.ts`
> - `packages/adapters/agent-opencode/src/permissions.ts`
> - `packages/adapters/agent-opencode/tests/adapter.spec.ts`
> - `packages/adapters/agent-opencode/tests/task-runner-integration.spec.ts`

## 1. 定位

`@she/agent-opencode` 是 SHE 的首个正式 agent adapter，把 OpenCode HttpApi 的异步 session/prompt/poll 模型映射到 SHE `AgentAdapter` 的事件流模型。

```text
SHE TaskRunner
  → OpenCodeAgentAdapter.createSession()
  → OpenCodeClient POST /api/session
  → prompt()
  → OpenCodeClient POST /api/session/{id}/prompt
  → poll session/active + session + messages
  → AgentEventEnvelope(text-delta / error / turn-end)
```

不依赖飞书 SDK、Docker、SHE server 或数据库。

## 2. HttpApi 契约

已验证并封装的接口：

```text
GET  /api/info
POST /api/session
GET  /api/session/{id}
GET  /api/session/active
POST /api/session/{id}/prompt
GET  /api/session/{id}/message?limit=20&order=desc
POST /api/session/{id}/interrupt
```

认证：HTTP Basic，用户名 `opencode`，密码来自本地凭据文件或注入配置。

client 不在日志、错误消息中输出：

- Basic 凭据；
- prompt 原文；
- 完整响应体（HTTP error 仅截断 300 字符）。

## 3. createSession 映射

SHE `AgentSessionSpec` → OpenCode：

```text
sessionKey               → title fallback: `SHE <sessionKey>`
workspace.path           → location.directory（必需）
model.providerId         → model.providerID
model.modelId            → model.id
model.variant            → model.variant
permissionRules          → SHE_OPENCODE_PERMISSION_RULES
```

没有 `workspace.path` 时 fail-closed；OpenCode 需要真实可解析目录。

## 4. prompt 事件映射

OpenCode `prompt` 立即返回 message id，然后 adapter 轮询：

```text
session outcome + active map + messages
```

映射：

| OpenCode 状态 | SHE 事件 |
|---|---|
| assistant message text 增长 | `text-delta` |
| outcome succeeded | `turn-end(completed)` |
| outcome interrupted | `turn-end(cancelled)` |
| outcome failed | `error` + `turn-end(error)` |
| HTTP/auth/unreachable | `error` + `turn-end(error)` |
| 超时 | interrupt + `error(timeout)` + `turn-end(error)` |
| caller abort | interrupt + `turn-end(cancelled)` |

任务必须收到 `turn-end`，否则上层 TaskRunner fail-closed。

## 5. 权限基线

`SHE_OPENCODE_PERMISSION_RULES` 是 OpenCode session 级规则，包含：

- 拒绝 `external_directory`；
- 拒绝 `webfetch` / `websearch` / `subagent` / `task`；
- 拒绝读取 `.env`、`.pem`、`.key`；
- 拒绝常见危险 shell：
  - sudo；
  - rm -rf；
  - git commit/push/merge/reset --hard/clean；
  - npm/pnpm/yarn install/add。

**重要边界**：permission rules 是纵深防御，不是 OS 沙箱。OpenCode 的 `external_directory` 不约束 shell 重定向，真正的写隔离必须由 M3 sandbox/broker 完成。

## 6. 报告校验

如果 `AgentPromptRequest.metadata.reportPath` 存在：

1. 校验 report 路径在 session workspace 内（避免路径逃逸）；
2. 校验文件存在且是普通文件；
3. 校验大小不超过 `maxReportBytes`（默认 2 MiB）。

错误码：

```text
report_missing
report_too_large
report_outside_workspace
```

未提供 `reportPath` 时不做文件校验；任务报告路径的正式注入由上层控制面/工作区任务继续完善。

## 7. 配置

```ts
const adapter = new OpenCodeAgentAdapter({
  baseUrl: 'http://127.0.0.1:49374',
  username: 'opencode',
  credential: '<from 0600 file>',
  timeoutMs: 10_000,
  promptTimeoutMs: 30 * 60_000,
  pollIntervalMs: 1_000,
  maxReportBytes: 2 * 1024 * 1024,
})
```

## 8. 测试覆盖

- Basic auth 与 session create body；
- model provider/id/variant 映射；
- canonical permission 规则存在；
- async prompt polling → text-delta + turn-end；
- report 文件存在/缺失；
- unauthorized/unreachable 稳定错误；
- OpenCode adapter + TaskRunner 完整集成：submit → OpenCode → succeeded。

当前全仓测试：`pnpm test` **49/49**。

## 9. 后续

- 真实 OpenCode 部署环境 smoke test；
- session resume 的 workspace/sessionKey 恢复需要控制面持久化；
- reportPath 注入与产物回收接入 TaskRunner/工作区；
- interrupt 真机验证；
- 接入 sandbox 后以容器/受限用户作为实际隔离边界。

## 10. 诊断命令草案

```text
she adapter opencode doctor --url <base-url> --credential-file <path>
she adapter opencode sessions
she adapter opencode status <session-id>
she adapter opencode interrupt <session-id>
```

帮助输出不得显示 credential、prompt 原文或完整 HTTP 响应体。
