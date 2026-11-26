# Gateway 配置与 feishu4dsh 连接状态

> 状态：T6.7 首版（配置、health probe、secret boundary）
> 代码：
> - `apps/companion/gateway.mjs`
> - `apps/companion/server.mjs`
> - `apps/pwa/src/components/GatewayPanel.vue`

## 1. 定位

SHE 是 agent control plane，不是飞书 SDK 宿主。

```text
飞书
  ↕
feishu4dsh（频道 adapter，持有飞书 secret）
  ↕ gateway.v1
SHE control plane
```

Gateway 页面负责：

- 显示 control-plane gateway.v1 是否可达；
- 显示 capability 数量；
- 配置 feishu4dsh adapter 的 loopback health URL；
- 显示 adapter 连接状态；
- 明确 secret boundary。

不负责：

- 读取飞书 app secret / verification token / encrypt key / tenant token；
- 启动 feishu4dsh；
- 把飞书 secret 传给 agent；
- 代替 feishu4dsh 做签名校验、解密或 token refresh。

## 2. 配置

默认文件：

```text
$XDG_CONFIG_HOME/she/gateway.json
回退 ~/.config/she/gateway.json
```

权限 `0600`，只保存：

```json
{
  "schema": 1,
  "channel": "feishu4dsh",
  "enabled": true,
  "adapterHealthUrl": "http://127.0.0.1:9090/health",
  "secretBoundary": "external-only"
}
```

约束：

- health URL 只允许 `127.0.0.1`、`localhost`、`::1`；
- 不允许 URL 内嵌用户名/密码；
- 不保存 token/secret 字段；
- 开启 adapter 配置时必须提供 health URL。

## 3. Companion API

```text
GET  /api/gateway
POST /api/gateway
```

POST body：

```json
{
  "enabled": true,
  "adapterHealthUrl": "http://127.0.0.1:9090/health"
}
```

写操作要求 `X-SHE-Local-Action: 1`。

status 返回：

- config；
- control-plane `probeSocket` 结果与 gateway.v1 capabilities；
- adapter health probe（3 秒超时、禁止 redirect、只允许 loopback）；
- secret boundary 说明。

## 4. PWA Gateway 页面

显示：

- control-plane reachable/offline；
- gateway protocol/capability；
- feishu4dsh enabled/connected/unreachable；
- adapter health URL 与 HTTP 状态；
- secret boundary 提示。

## 5. 当前限制

- feishu4dsh 尚未实现统一 `/health` endpoint 时，会显示 unreachable；
- 首版不保存 adapter token，因此带鉴权的 health endpoint 暂不支持；
- 不自动启动/停止 feishu4dsh；
- 真机飞书验收仍属于 T4.6；
- Gateway 页面不会让 agent 接触飞书 secret。

## 6. 验收

- [x] loopback health URL 校验；
- [x] secret 字段不落盘；
- [x] control-plane gateway.v1 状态；
- [x] adapter health probe；
- [x] PWA 页面；
- [ ] feishu4dsh 真机联调（T4.6）；
- [ ] adapter token/auth health 支持。
