# SHE public packages 0.1.0（gateway adapter baseline）

> 日期：2026-11-25
> Release tag：`v0.1.0-packages.1`
> 状态：GitHub Release tarball 发布；npm registry 尚未发布
> 适用：feishu4dsh integration 分支、SHE 自身集成测试

## 1. 发布资产

GitHub Release 附件：

```text
she-protocol-0.1.0.tgz
she-client-0.1.0.tgz
she-gateway-sdk-0.1.0.tgz
```

下载地址模板：

```text
https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/<asset>
```

## 2. SHA-256

```text
7a57881cf08c062c18686b72aab3a788d3a12167af92d7b9ecca9294a02f80d0  she-protocol-0.1.0.tgz
edcad42bb0aeb69e0515844a099a9319c23b0659898f6de9391b6c7db0e44eec  she-client-0.1.0.tgz
181c823eb5e7d58a55f05878e252502e2da5b08d9a783e5fd2ffc4aafeadacfa  she-gateway-sdk-0.1.0.tgz
```

## 3. 包边界

```text
@she/protocol   纯类型/常量/golden fixtures
@she/client     control-plane + broker Unix-socket clients
@she/gateway-sdk 可选 GatewayAdapter + SheGatewayBridge 参考实现
```

均不依赖：

- SHE core/control/store/broker 实现；
- 飞书 SDK；
- dsh 宿主；
- Docker；
- 数据库。

## 4. tarball 安装

由于 npm registry 尚未发布，tarball 的传递依赖不会自动解析到其他 tarball。消费方需要同时声明直接依赖和 pnpm override。

示例 `package.json`：

```json
{
  "dependencies": {
    "@she/protocol": "https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-protocol-0.1.0.tgz",
    "@she/client": "https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-client-0.1.0.tgz",
    "@she/gateway-sdk": "https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-gateway-sdk-0.1.0.tgz"
  }
}
```

pnpm 11 的 overrides 放在 `pnpm-workspace.yaml`，并需要允许 URL 形式的传递依赖：

```yaml
blockExoticSubdeps: false
overrides:
  '@she/protocol': https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-protocol-0.1.0.tgz
  '@she/client': https://github.com/pancong0711/she/releases/download/v0.1.0-packages.1/she-client-0.1.0.tgz
```

`blockExoticSubdeps: false` 只应作为 registry 发布前的临时消费方案；正式切回 npm registry 后应删除该设置。

然后：

```sh
pnpm install --frozen-lockfile
```

验证：

```sh
node --input-type=module -e "import { SheClient, SandboxBrokerClient } from '@she/client'; import { GATEWAY_V1_FIXTURES } from '@she/protocol'; import { SheGatewayBridge } from '@she/gateway-sdk'; console.log('ok', GATEWAY_V1_FIXTURES.protocolVersion, typeof SheClient, typeof SandboxBrokerClient, typeof SheGatewayBridge)"
```

## 5. 与 feishu4dsh 的关系

feishu4dsh integration 分支可以选择：

### 方案 A：只依赖 protocol/client

```text
@she/protocol + @she/client
```

然后在 feishu4dsh 内维护等价 gateway adapter/bridge。这是当前 integration 骨架的模式。

### 方案 B：使用 gateway-sdk

```text
@she/protocol + @she/client + @she/gateway-sdk
```

直接使用：

```ts
import { SheGatewayBridge } from '@she/gateway-sdk'
```

优点：

- bridge 生命周期、命令/交互转发、事件 pump 已有参考实现；
- 减少 feishu4dsh 自维护代码。

注意：

- `@she/gateway-sdk` 仍是 0.1.x，API 可能继续演进；
- feishu4dsh 仍需自己实现真正的 `GatewayAdapter.render()` 和飞书审批/文件运行时；
- gateway-sdk 不包含飞书 SDK。

## 6. 长期发布路线

当前阶段：

```text
GitHub Release tarball
```

下一阶段应切换到：

```text
npm registry（或私有 registry）
@she/protocol@~0.1.x
@she/client@~0.1.x
@she/gateway-sdk@~0.1.x
```

切换条件：

- npm scope/发布权限确认；
- tarball 验证通过；
- 干净环境 frozen-lockfile 通过；
- 兼容矩阵和 golden fixtures 稳定。

## 7. 回滚

- feishu4dsh 保持 `she.enabled: false`；
- 回退到旧 `secretary` 路径；
- Release tarball 保留；
- 不回滚已写入的 SHE 状态，保留用于分析。
