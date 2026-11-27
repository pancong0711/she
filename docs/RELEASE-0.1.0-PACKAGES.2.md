# SHE public packages：gateway adapter compatibility update

> 日期：2026-11-27
> Release tag：`v0.1.0-packages.2`
> 状态：GitHub Release tarball
> 关联：feishu4dsh R71

## 1. 变更

- `@she/client` 升级到 `0.1.1`；
- 公开并验证 artifact 兼容 API：
  - `client.artifacts(taskId)`
  - `client.downloadArtifact(artifactId)`
- 新增 feishu4dsh 全链路 consumer 契约测试，覆盖：
  - health / hello；
  - command / interaction；
  - NDJSON events；
  - artifact list；
  - artifact bytes download + content headers。
- `@she/protocol` 保持 `0.1.0`，`gateway.v1` 不变；
- `@she/gateway-sdk` 保持现有版本。

## 2. 发布资产

```text
she-protocol-0.1.0.tgz
she-client-0.1.1.tgz
she-gateway-sdk-0.1.0.tgz
```

下载地址模板：

```text
https://github.com/pancong0711/she/releases/download/v0.1.0-packages.2/<asset>
```

SHA-256：

```text
abb8ee6eb4197b21ce01e719ef400bea25031de624364ee67c164698fddeeaf3  she-protocol-0.1.0.tgz
b8ef5bf2f1645eeef3e0e40571f32560c7f77993cea9b142d572b7f1fdf521be  she-client-0.1.1.tgz
6d838191bb5a7c728199a1b7759452c5c356e5201fb0cd5ff2fb14f122d8a70c  she-gateway-sdk-0.1.0.tgz
```

## 3. feishu4dsh 接入

`package.json`：

```json
{
  "dependencies": {
    "@she/protocol": "https://github.com/pancong0711/she/releases/download/v0.1.0-packages.2/she-protocol-0.1.0.tgz",
    "@she/client": "https://github.com/pancong0711/she/releases/download/v0.1.0-packages.2/she-client-0.1.1.tgz"
  }
}
```

`pnpm-workspace.yaml`：

```yaml
blockExoticSubdeps: false
overrides:
  '@she/protocol': https://github.com/pancong0711/she/releases/download/v0.1.0-packages.2/she-protocol-0.1.0.tgz
  '@she/client': https://github.com/pancong0711/she/releases/download/v0.1.0-packages.2/she-client-0.1.1.tgz
```

然后：

```sh
pnpm install
pnpm typecheck
pnpm test
```

## 4. 后续

完成 feishu4dsh 的 `FeishuRenderPort.sendFile` 接入后，file RenderIntent 和
artifact.created 才能做真实文件发送；群聊审批仍由 feishu4dsh 执行。
