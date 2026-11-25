# 公开包打包与发布

> 日期：2026-11-25
> 状态：T4.1a 首版
> 命令：`pnpm pack:public [output-dir]`

## 1. 公开包

gateway adapter（首期 feishu4dsh）只应依赖：

```text
@she/protocol
@she/client
@she/gateway-sdk   # 可选参考 bridge
```

`@she/gateway-sdk` 是可选包：提供 `GatewayAdapter` 与 `SheGatewayBridge`，不包含平台 SDK，不依赖 SHE 内部状态。

不应依赖：

```text
@she/core
@she/control
@she/store-sqlite
@she/agent-*
@she/sandbox-*
she-control-plane server internals
```

## 2. 打包命令

```sh
pnpm pack:public
# 或指定输出目录
pnpm pack:public /tmp/she-packages
```

脚本行为：

1. `pnpm build`；
2. `pnpm --filter @she/protocol pack`；
3. `pnpm --filter @she/client pack`；
4. `pnpm --filter @she/gateway-sdk pack`；
5. 输出 tarball 列表和 SHA-256。

默认输出目录：

```text
artifacts/packages/
```

该目录已加入 `.gitignore`，tarball 不进入 Git。

## 3. 本地联调

feishu4dsh 侧可以使用：

```sh
pnpm add /tmp/she-packages/she-protocol-0.1.0.tgz
pnpm add /tmp/she-packages/she-client-0.1.0.tgz
# 可选
pnpm add /tmp/she-packages/she-gateway-sdk-0.1.0.tgz
```

如果只安装 `she-client` 的 tarball，其传递依赖 `@she/protocol` 仍会按 semver 查找 registry；因此没有 registry 时，必须同时显式安装 `she-protocol` tarball 或在 pnpm overrides 中指向 tarball URL。

约束：

- 只能在临时 integration 分支/临时环境使用；
- 不提交 `file:` 或本机绝对路径依赖；
- 不提交包含本机路径的 `pnpm-lock.yaml`/`node_modules` 变更；
- 正式 PR 前改为 registry semver；
- 主分支锁定首期 `~0.1.x`。

## 3.1 GitHub Release tarball

在 npm registry 发布前，使用 GitHub Release 固定 tarball：

```text
https://github.com/pancong0711/she/releases/tag/v0.1.0-packages.1
```

消费说明见：

```text
docs/RELEASE-0.1.0-PACKAGES.md
```

注意：tarball 的传递依赖需要同时配置 pnpm overrides，否则 `@she/protocol` / `@she/client` 会去找 registry。

## 4. 发布版本策略

```text
@she/protocol  0.1.x
@she/client    0.1.x
SHE            0.1.x
wire protocol  gateway.v1
```

- protocol/client 同一发布列车；
- wire protocol 版本独立；
- 不兼容 wire 变化必须升 gateway.v2 或显式提供协商；
- protocol/client pack 时必须把 workspace dependency 重写成同版本 semver；
- 发布后记录 tarball SHA-256 和 Git commit。

## 5. Golden fixtures

`@she/protocol` 导出：

```ts
GATEWAY_V1_FIXTURES
GATEWAY_V1_COMMAND_REQUEST
GATEWAY_V1_COMMAND_RESULT
GATEWAY_V1_RENDER_INTENTS
GATEWAY_V1_TASK_EVENT
GATEWAY_V1_SERVER_EVENT
```

两个仓库的 CI 都应引用这些 typed fixtures。禁止在 feishu4dsh 中手写另一份协议样本作为事实源。

## 6. 发布检查清单

- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm test` 通过；
- [ ] `pnpm pack:public` 成功；
- [ ] tarball 只包含 `dist/` 与 `package.json`；
- [ ] client tarball dependency 已从 `workspace:*` 改写为 `0.1.0`；
- [ ] golden fixtures 与 gateway protocol 一致；
- [ ] README / CHANGELOG / 兼容矩阵已更新；
- [ ] 记录 SHA-256 与 commit；
- [ ] 在 feishu4dsh 临时分支完成 fake server/只读闭环后再升级为正式依赖。
