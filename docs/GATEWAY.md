# Gateway：SHE 内置飞书通道与可选外部 adapter

> 状态：companion 0.6.0 内置飞书 gateway 首版
> 代码：
> - `apps/feishu-gateway/src/main.mjs`
> - `apps/companion/feishu-gateway-manager.mjs`
> - `apps/companion/gateway.mjs`
> - `apps/companion/server.mjs`
> - `apps/pwa/src/components/GatewayPanel.vue`

## 0. 首选连接方式：SHE 内置 Feishu gateway

SHE 是独立 agent control plane，不是 dsh 插件。用户不需要预先安装 dsh 或 feishu4dsh。

首选链路：

```text
飞书
  ↕ 官方 Lark SDK WebSocket
SHE built-in Feishu gateway（companion 管理的本地子进程）
  ↕ @she/client / gateway.v1
SHE control plane
  → core worker / agent runtime
```

PWA Gateway 页面提供：

- Feishu App ID / App Secret 配置；
- Domain（Feishu / Lark）；
- 群聊 require mention；
- sender/chat allowlist；
- 保存并连接、停止、刷新；
- 进程状态和最近日志。

凭据保存位置：

```text
$XDG_CONFIG_HOME/she/feishu.env
回退 ~/.config/she/feishu.env
权限：0600
```

Secret boundary：

- App Secret 只由 built-in Feishu gateway 进程读取；
- core、worker、agent、sandbox 不读取该文件；
- PWA 保存后不返回 App Secret 值；
- 日志不输出 App Secret；
- 飞书 WebSocket 凭据不会进入 task prompt。

当前内置 gateway 支持：

- `/she help`、`/she list`、`/she status`、`/she submit`、`/she cancel`；
- command result 文本回传；
- task accepted/completed/failed；
- agent text delta 聚合后随完成消息返回。

后续增强：

- 交互卡片/审批/表单；
- artifact 文件下载与飞书文件审批；
- 卡片化实时进度；
- systemd user service 常驻/linger；
- 多频道/多机器人。

## 1. 外部 feishu4dsh adapter（高级可选项）

下面内容仅适用于用户自己另外部署了 feishu4dsh 的情况。SHE 不默认依赖 dsh 或 feishu4dsh。


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

## 3. feishu4dsh 安装/前置条件

Gateway 页面同时显示只读的 feishu4dsh 安装状态：

```text
GET /api/feishu4dsh
```

检查内容：

- `dsh` 是否存在及版本；
- `$DSH_HOME/profiles/<profile>/package.json` 是否声明 `feishu4dsh`；
- feishu4dsh 的 0600 env 文件是否存在，以及是否包含
  `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 变量名；
- user service unit 是否存在、是否 enabled/active。

它只检查变量名和文件权限，**绝不返回 secret 值**。

PWA 可以提供受控安装按钮：

```text
POST /api/jobs {"kind":"feishu4dsh-install","profile":"feishu4dsh","packageSpec":"..."}
```

job 实际只执行：

```text
dsh plugin --profile <profile> add <packageSpec>
```

不会：

- 使用 sudo；
- 写飞书 secret；
- 自动安装/启动 systemd 服务；
- 把凭据传给 agent。

安装源可以是 npm 包名、git URL 或用户可控本地路径。因为 feishu4dsh
尚未提供 SHE 可依赖的稳定公共发布矩阵，默认 UI 使用其 GitHub 仓库 URL，
用户也可以替换为已审核的固定 tarball/版本。

安装 feishu4dsh 不等于 SHE 已接通飞书：

```text
安装 dsh 插件
  → 飞书 app 凭据/ACL 配置
  → feishu4dsh 用户服务运行
  → feishu4dsh 实现 gateway.v1 adapter（T4.6）
  → SHE 真机闭环验收
```

前三步只证明“飞书 ↔ feishu4dsh ↔ dsh”通道可能可用；SHE 侧仍不能宣称完成。

## 4. 内置 Feishu gateway Companion API

```text
GET  /api/feishu/gateway/status
POST /api/feishu/gateway/config
POST /api/feishu/gateway/start
POST /api/feishu/gateway/stop
```

写操作要求 `X-SHE-Local-Action: 1`。

`status` 返回：

- env 文件路径、权限、是否配置 App ID/Secret（不返回值）；
- domain、requireMention、allowlist；
- gateway 进程 running/pid/startedAt/lastError；
- 最近日志。

`config` 可省略 App Secret（空字符串表示保留旧值）。

## 5. 外部 adapter Companion API

```text
GET  /api/gateway
POST /api/gateway
GET  /api/feishu4dsh
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

## 6. PWA Gateway 页面

显示：

- dsh 安装状态、profile、插件、env 文件变量名、user service；
- “在 dsh profile 中安装/更新 feishu4dsh”按钮及实时 job 日志；
- control-plane reachable/offline；
- gateway protocol/capability；
- feishu4dsh adapter enabled/connected/unreachable；
- adapter health URL 与 HTTP 状态；
- secret boundary 提示。

## 7. 当前限制

- feishu4dsh 尚未实现统一 `/health` endpoint 时，会显示 unreachable；
- 首版不保存 adapter token，因此带鉴权的 health endpoint 暂不支持；
- 安装 job 只安装 dsh 插件，不创建 systemd unit、不写 env secret；
- 不自动启动/停止 feishu4dsh；
- 真机飞书验收仍属于 T4.6；
- Gateway 页面不会让 agent 接触飞书 secret。

## 8. 验收

- [x] loopback health URL 校验；
- [x] secret 字段不落盘；
- [x] control-plane gateway.v1 状态；
- [x] adapter health probe；
- [x] PWA 页面；
- [x] 只读 feishu4dsh profile/env 变量名/user service 检查；
- [x] PWA 受控安装 dsh 插件 job（无 sudo、无 secret）；
- [ ] feishu4dsh 真机联调（T4.6）；
- [ ] adapter token/auth health 支持。
