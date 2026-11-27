# SHE public packages：gateway.v1 direct-message compatibility update

> 日期：2026-11-27
> Release tag：`v0.1.1-packages.1`
> 状态：GitHub Release tarball
> 关联：feishu4dsh R72/R73、SHE gateway direct messages

## 1. 变更

- `@she/protocol` 升级到 `0.1.1`：
  - 新增 `GatewayMessageRequest`；
  - 新增 `GatewayMessageResult`；
  - `GatewayApi` 增加可选 `message()`。
- `@she/client` 升级到 `0.1.2`：
  - 新增原生 `client.message(event)`，调用 `POST /v1/messages`；
  - 返回 `GatewayMessageResult`。
- `@she/gateway-sdk` 升级到 `0.1.1`，仅同步公开依赖版本。
- wire protocol 仍为 `gateway.v1`，没有破坏性 wire 变更。

## 2. 发布资产

```text
she-protocol-0.1.1.tgz
she-client-0.1.2.tgz
she-gateway-sdk-0.1.1.tgz
```

下载地址模板：

```text
https://github.com/pancong0711/she/releases/download/v0.1.1-packages.1/<asset>
```

SHA-256：

```text
e91d023bc47a1745561f5403f900061fce8eececf56e6705539c9aece3b0b0f9  she-protocol-0.1.1.tgz
ee672ac15474241e659f4192555bd06d88734dca4168ec6012252d77c38b57b0  she-client-0.1.2.tgz
2c9fef7a601305f26e097f395180b0898d7ee0fc6573ae1bc79982a1821907ba  she-gateway-sdk-0.1.1.tgz
```

## 3. feishu4dsh 切换方式

```json
{
  "dependencies": {
    "@she/protocol": "https://github.com/pancong0711/she/releases/download/v0.1.1-packages.1/she-protocol-0.1.1.tgz",
    "@she/client": "https://github.com/pancong0711/she/releases/download/v0.1.1-packages.1/she-client-0.1.2.tgz"
  }
}
```

`pnpm-workspace.yaml` 的 overrides 同步更新，并继续保留：

```yaml
blockExoticSubdeps: false
```

然后：

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

feishu4dsh 侧应将 R73 的本地同形状 `SheGatewayMessageResult` 替换为
`@she/protocol` 正式导出的 `GatewayMessageResult`，并优先使用原生
`@she/client.message()`。详细复核单：

```text
docs/20261127-需求-feishu4dsh-切换到SHE-packages.1.md
```

## 4. 兼容矩阵

| 消费方 | @she/protocol | @she/client | gateway protocol |
|---|---|---|---|
| feishu4dsh 0.23.x+ standalone | 0.1.1 | 0.1.2 | `gateway.v1` |

## 5. 验证

```text
pnpm typecheck  ✓
pnpm test       ✓ 122/122
pnpm pack:public ✓
tarball dependency rewrite: workspace:* → 0.1.1 / 0.1.2 ✓
GatewayMessageResult in protocol d.ts ✓
client.message in client d.ts ✓
```
