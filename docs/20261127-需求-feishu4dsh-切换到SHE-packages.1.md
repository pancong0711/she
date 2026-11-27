# 需求（feishu4dsh 侧复核）：切换到 SHE packages.1 公开包

> 日期：2026-11-27 ｜ 状态：待 feishu4dsh 侧复核/实施
> SHE Release：`v0.1.1-packages.1`
> 关联：feishu4dsh R73、SHE `docs/RELEASE-0.1.1-PACKAGES.1.md`

## 1. 结论

SHE 已发布包含 direct-message 正式类型和原生 `client.message()` 的新公开包。
feishu4dsh 侧需要做一次依赖和类型收口：

- 从 packages.2 切换到 packages.1；
- 删除 R73 的本地同形状 `SheGatewayMessageResult` 镜像类型；
- 改用 `@she/protocol` 的 `GatewayMessageResult`；
- 优先使用 `@she/client` 原生 `client.message()`；
- 保留现有 `/v1/messages` 兼容层作为旧客户端 fallback 或删除。

这是类型/依赖收口，不改变 R73 已实现的 task/topic → RenderTarget 关联逻辑。

## 2. 新包版本

```text
@she/protocol      0.1.1
@she/client        0.1.2
@she/gateway-sdk   0.1.1（可选）
```

Release：

```text
https://github.com/pancong0711/she/releases/tag/v0.1.1-packages.1
```

SHA-256：

```text
e91d023bc47a1745561f5403f900061fce8eececf56e6705539c9aece3b0b0f9  she-protocol-0.1.1.tgz
ee672ac15474241e659f4192555bd06d88734dca4168ec6012252d77c38b57b0  she-client-0.1.2.tgz
2c9fef7a601305f26e097f395180b0898d7ee0fc6573ae1bc79982a1821907ba  she-gateway-sdk-0.1.1.tgz
```

## 3. 改动要求

### 3.1 package.json

```json
{
  "dependencies": {
    "@she/protocol": "https://github.com/pancong0711/she/releases/download/v0.1.1-packages.1/she-protocol-0.1.1.tgz",
    "@she/client": "https://github.com/pancong0711/she/releases/download/v0.1.1-packages.1/she-client-0.1.2.tgz"
  }
}
```

### 3.2 pnpm-workspace.yaml

```yaml
blockExoticSubdeps: false
overrides:
  '@she/protocol': https://github.com/pancong0711/she/releases/download/v0.1.1-packages.1/she-protocol-0.1.1.tgz
  '@she/client': https://github.com/pancong0711/she/releases/download/v0.1.1-packages.1/she-client-0.1.2.tgz
```

### 3.3 类型切换

```ts
import type { GatewayMessageResult } from '@she/protocol'

export interface SheMessageClient {
  message(event: GatewayMessageEvent, signal?: AbortSignal): Promise<GatewayMessageResult>
}
```

删除本地：

```ts
export interface SheGatewayMessageResult {
  readonly accepted: boolean
  readonly requestId: string
  readonly taskId?: string
  readonly topicId?: string
}
```

runtime 的 `renderResult()` 已能接受 `GatewayMessageResult`，只保留一条类型来源。

### 3.4 原生 client.message()

`@she/client@0.1.2` 已提供：

```ts
client.message(event: GatewayMessageEvent): Promise<GatewayMessageResult>
```

feishu4dsh 的 `createSheGatewayClient()` 应优先使用原生方法；兼容层仅用于
确需兼容旧 client 的过渡分支。

## 4. 验收

- [ ] `pnpm install` 从 packages.1 成功解析 `@she/protocol` / `@she/client`；
- [ ] lockfile 中无 packages.2 残留；
- [ ] 不再存在本地重复的 `SheGatewayMessageResult` 类型；
- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm test` 全量通过；
- [ ] `pnpm build` 通过；
- [ ] fake UDS 仍验证：
  - message result 的 taskId/topicId 被解析；
  - task/topic target 写入；
  - artifact.created 回到原 conversation；
  - 畸形/旧回执负例；
- [ ] 与 SHE 真机联调时普通消息可触发 task 并由飞书收到结果。

## 5. 边界

- 不要求本轮实现多 agent、`/agent`、`/new` 或 attachment upload；
- 不改变飞书 transport、卡片、文件审批和 event cursor 逻辑；
- 不把 conversation→agent 路由搬到 feishu4dsh；
- 不把 SHE token、socket 或宿主路径发送到飞书。
