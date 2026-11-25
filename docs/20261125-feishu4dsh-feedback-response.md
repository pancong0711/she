# 回复 feishu4dsh 第二轮评审反馈

> 日期：2026-11-25
> 状态：已处理
> 来源：
> - `20260819-feishu4dsh/docs/20261125-评审-she-protocol-client与接入需求.md`
> - `20260819-feishu4dsh/docs/20261125-需求-feishu4dsh去SHE与飞书能力模块化.md`
> 关联：
> - `docs/PRODUCT-VISION.md`
> - `docs/DEPLOYMENT.md`
> - `docs/TASK-RUNNER.md`
> - `docs/20261125-feishu4dsh-review-response.md`

## 1. 结论

feishu4dsh 第二轮反馈已全部并入 SHE 的实施基线。主要变化：

1. `RenderIntent` 的 `card` 缺口已解决：新增平台无关的 `CardRenderIntent`，不再让文档承诺不存在的 kind；
2. `/v1/commands` 结果结构已采用反馈建议：`commandResult.renderIntents`；
3. 发布策略确认：feishu4dsh 主分支不提交 `file:` 外部路径依赖；联调使用 `pnpm pack` tarball，正式依赖使用 semver；
4. socket/token/service 命名已形成统一部署约定；
5. protocol/client 同发布列车，wire protocol 独立为 gateway.v1；
6. 兼容矩阵进入 REQUIREMENTS 与部署文档。

当前测试基线：`pnpm typecheck` ✓，`pnpm test` **36/36**。

## 2. RenderIntent 缺口处理

反馈指出：集成文档曾写有通用 `card`，但 protocol 实际只有 `text/progress/status/form/approval/file`。

处理结果：**增加可选 `CardRenderIntent`，而不是删除卡片能力**。原因：

- channel capability 里已有 `card.outbound`；
- 飞书侧存在大量列表/状态/帮助/菜单类卡片；
- 只靠 `extensions` 承载会让 SHE 和 gateway 都绕过语义层，最终复制平台细节。

新增的平台无关模型：

```ts
interface CardRenderIntent {
  kind: 'card'
  renderId: string
  sequence: number
  title?: string
  subtitle?: string
  blocks: readonly CardBlock[]
  actions?: readonly CardAction[]
}

type CardBlock =
  | { type: 'text'; text: string; format?: 'plain' | 'markdown' }
  | { type: 'fields'; fields: { label: string; value: string }[] }
  | { type: 'list'; items: { id; primary; secondary?; selected? }[] }
  | { type: 'divider' }
```

边界：

- 不包含飞书卡片 JSON；
- 不包含飞书按钮 payload；
- 飞书具体卡片/按钮/菜单由 feishu4dsh 的 renderer 转换；
- 现有 `text(format=markdown)` 继续用于简单消息；
- `card` 与 `card.outbound` capability 对应；
- 后续只增字段/block 类型，不重命名。

## 3. `/v1/commands` 返回形态

已采用建议结构：

```ts
interface GatewayCommandResult {
  accepted: boolean
  requestId: string
  taskId?: string
  topicId?: string
  commandResult?: {
    renderIntents: RenderIntent[]
  }
}
```

语义：

- 只读命令（help/status/list）可在 `commandResult.renderIntents` 同步返回首批展示；
- 写命令（submit/cancel 等）返回 `accepted` + `taskId`，后续状态走 `/v1/events`；
- 无论同步还是事件流，RenderIntent 都必须有稳定 `renderId`；
- gateway 根据 `renderId + sequence` 做幂等，重复事件不能重复发送。

## 4. cursor 重放窗口与 snapshot

接受反馈建议：

- control-plane 配置 `eventRetention`：
  - 最大事件数；
  - 最大保留时间；
  - 双限制取先到者；
- cursor 过期返回结构化 `cursor_expired`；
- 增加只读 snapshot 入口，使 gateway 在 cursor 过期后重建状态，而不是静默丢事件。

具体 endpoint 和默认保留值在 control-plane server 实现任务中确定，纳入 T4.1b。

## 5. socket/token/service 命名

已新增 `docs/DEPLOYMENT.md`，统一如下：

```text
socket:
  $XDG_RUNTIME_DIR/she/control.sock
  回退：~/.local/run/she/control.sock

token:
  ~/.config/she/token（可选，0600）

services:
  she-control-plane.service
  she-broker.service
```

约束：

- socket 0600；
- 不监听 TCP/LAN；
- 目录 0700；
- `@she/client` 接收显式 socketPath，不自行猜路径；
- feishu4dsh 只读展示这些路径，不自动创建/修改；
- token 不写入 PWA、日志或 agent 可见环境。

## 6. 版本与发布策略

已确认：

```text
@she/protocol  0.1.x
@she/client    0.1.x
SHE            0.1.x
wire protocol  gateway.v1
```

- `@she/protocol` 与 `@she/client` 同一发布列车；
- wire protocol 版本独立；
- feishu4dsh 首期锁 `~0.1.x`；
- 主分支禁止 `file:`/本机绝对路径依赖；
- 本地联调用 `pnpm pack` tarball；
- 正式依赖必须改为 semver；
- 两仓库 CI 跑同一套 protocol golden fixtures。

兼容矩阵模板：

| SHE | @she/protocol | @she/client | gateway protocol | feishu4dsh | 状态 |
|---|---|---|---|---|---|
| 0.1.x | 0.1.x | 0.1.x | v1 | 待接入 | 开发中 |

## 7. 当前 2611she 可消费状态

| 包 | 状态 |
|---|---|
| `@she/protocol` | 真实导出，含 gateway/agent/sandbox v1、canonical capability、CardRenderIntent、command result |
| `@she/client` | 真实 Unix-socket client，health/hello/command/interaction/events |
| `@she/core` | 领域实体、状态机、ports、事件、lease |
| `@she/control` | TaskService、TopicQueue、TaskRunner、InMemory repo |
| `@she/store-sqlite` | schema v2、SQLite repo、request spool、迁移与重启测试 |

尚未完成：

- 正式 tarball/npm 打包发布；
- control-plane `/v1/*` server；
- protocol golden fixtures 跨仓库分发；
- `she-control-plane.service` / `she-broker.service` 实现。

这些已进入任务单：T4.1a（打包发布）与 T4.1b（control-plane server）。

## 8. 下一阶段顺序

1. 打包 `@she/protocol` / `@she/client`，提供 tarball；
2. 实现 control-plane server 的 `/v1/health`、`/v1/hello`、`/v1/commands`、`/v1/interactions`、`/v1/events`；
3. 增加 protocol golden fixtures 与 cursor-expired 合约测试；
4. feishu4dsh 在临时 integration 分支消费 tarball，验证 F-SHE-2；
5. 进入 M2 OpenCode adapter；
6. M3 sandbox/broker；
7. M6 PWA 控制台。
