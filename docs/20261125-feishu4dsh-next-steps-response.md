# 回复：feishu4dsh SHE 接入下一步建议

> 日期：2026-11-25
> 状态：P0 发布阻塞已提供 GitHub Release 方案
> 关联：
> - `20260819-feishu4dsh/docs/20261125-规划-she接入下一步.md`
> - `docs/RELEASE-0.1.0-PACKAGES.md`
> - `docs/M4-FEISHU4DSH-THIN-ADAPTER.md`

## 1. 结论

feishu4dsh 的建议整体接受。SHE 侧已完成两项发布前置：

1. `@she/gateway-sdk` 已纳入公开包打包流程；
2. 已创建 GitHub Release：

```text
https://github.com/pancong0711/she/releases/tag/v0.1.0-packages.1
```

由于 npm registry 尚未发布，当前使用 Release tarball 作为正式联调依赖，不再依赖本机解包目录。

## 2. Release 资产

```text
she-protocol-0.1.0.tgz
she-client-0.1.0.tgz
she-gateway-sdk-0.1.0.tgz
```

SHA-256：

```text
7a57881cf08c062c18686b72aab3a788d3a12167af92d7b9ecca9294a02f80d0  she-protocol-0.1.0.tgz
edcad42bb0aeb69e0515844a099a9319c23b0659898f6de9391b6c7db0e44eec  she-client-0.1.0.tgz
181c823eb5e7d58a55f05878e252502e2da5b08d9a783e5fd2ffc4aafeadacfa  she-gateway-sdk-0.1.0.tgz
```

下载 URL：

```text
https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-protocol-0.1.0.tgz
https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-client-0.1.0.tgz
https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-gateway-sdk-0.1.0.tgz
```

## 3. feishu4dsh 消费方式

推荐 integration 分支使用三个 tarball URL。

`package.json`：

```json
{
  "dependencies": {
    "@she/protocol": "https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-protocol-0.1.0.tgz",
    "@she/client": "https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-client-0.1.0.tgz",
    "@she/gateway-sdk": "https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-gateway-sdk-0.1.0.tgz"
  }
}
```

`pnpm-workspace.yaml`：

```yaml
blockExoticSubdeps: false
overrides:
  '@she/protocol': https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-protocol-0.1.0.tgz
  '@she/client': https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-client-0.1.0.tgz
```

验证：

```sh
pnpm install --frozen-lockfile
node --input-type=module -e "import { SheClient, SandboxBrokerClient } from '@she/client'; import { GATEWAY_V1_FIXTURES } from '@she/protocol'; import { SheGatewayBridge } from '@she/gateway-sdk'; console.log('ok', GATEWAY_V1_FIXTURES.protocolVersion, typeof SheClient, typeof SandboxBrokerClient, typeof SheGatewayBridge)"
```

SHE 已在本机临时消费工程中验证该组合可安装并 import 成功。

## 4. 关于 gateway-sdk

`@she/gateway-sdk` 现在是公开 Release 资产，包含：

- `GatewayAdapter`；
- `GatewayInboundSink`；
- `RenderReceipt`；
- `SheGatewayBridge`：命令/交互转发、RenderIntent 渲染、事件 pump。

feishu4dsh 有两种选择：

### 方案 A：继续自维护等价 adapter

优点：

- 依赖面更小，只依赖 protocol/client；
- 与现有 integration 骨架兼容。

### 方案 B：使用 gateway-sdk

优点：

- 减少自维护 bridge 代码；
- 与 SHE 侧参考实现保持一致；
- 后续事件处理改进可以直接升级。

建议：

- P1 先用 A 保持当前骨架；
- P2 event/render runtime 稳定后评估 B；
- 无论 A/B，真正飞书卡片/文件/审批仍由 feishu4dsh 实现。

## 5. SHE 侧当前已具备的能力

- protocol/client/gateway-sdk tarball；
- golden fixtures；
- `/v1/events` NDJSON；
- `cursor_expired` → `/v1/snapshot`；
- command/interaction/service；
- approval/file RenderIntent 契约；
- sandbox broker 与 OpenCode adapter。

## 6. 建议 feishu4dsh 下一步

按建议稿继续：

1. P1：改 tarball URL 依赖，提交干净 lockfile；
2. P2：补 `events.ts` / `adapter.ts` / `runtime.ts`；
3. P2：处理 cursor_expired、snapshot 重建、renderId+sequence 幂等；
4. P3：接真实审批/文件/表单运行时；
5. P4：双轨开关；
6. P5：fake socket + 飞书真机验收。

## 7. 尚未解决

- npm registry scope 与发布权限仍未确认；
- Release tarball + `blockExoticSubdeps:false` 是临时方案；
- npm 正式发布后应删除 URL 依赖和临时 override；
- `@she/gateway-sdk` 版本仍随 0.1.x 演进，需锁定兼容矩阵。
