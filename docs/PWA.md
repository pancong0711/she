# SHE PWA 本地控制台

> 日期：2026-11-25
> 状态：T6.1–T6.2 完成，T6.3 首屏只读面板完成
> 代码：
> - `apps/pwa/`
> - `apps/pwa/server.mjs`
> - `apps/pwa/src/App.vue`
> - `apps/pwa/public/manifest.webmanifest`
> - `apps/pwa/public/sw.js`

## 1. 定位

PWA 是 SHE 本地控制台的 UI，不是第二套业务系统：

```text
浏览器/PWA
  │ 同源 HTTP: http://127.0.0.1:8787
  ▼
apps/pwa/server.mjs
  ├─ 静态文件：apps/pwa/dist
  └─ /v1/* 反向代理
          │ Unix socket
          ▼
    she-control-plane
```

PWA 不直接访问 Docker、broker socket、飞书 secret 或 SHE SQLite。

## 2. 技术栈

- Vue 3 + Vite + TypeScript；
- 手写 `manifest.webmanifest`；
- 手写 service worker 缓存静态 shell；
- Node 标准库实现本地静态服务器和 API 代理；
- 无云后端。

参考 `2609-assignment-assistant` 的“本地引擎 + PWA 前端”模式。

## 3. 启动

构建：

```sh
pnpm pwa:build
```

启动本地 PWA host：

```sh
pnpm pwa:serve
```

打开：

```text
http://127.0.0.1:8787
```

默认控制面 socket：

```text
$XDG_RUNTIME_DIR/she/control.sock
回退 ~/.local/run/she/control.sock
```

可覆盖：

```text
SHE_CONTROL_SOCKET
SHE_PWA_PORT
SHE_TOKEN_FILE
```

浏览器不会接触 token；PWA host 从 `SHE_TOKEN_FILE` 读取后注入代理请求。

## 4. 当前页面

已完成：

- Dashboard：
  - control plane health；
  - gateway protocol；
  - snapshot cursor；
  - task 数量/运行数/attention 数；
  - recent tasks；
- Tasks：
  - 只读任务表；
  - 状态、摘要、priority、更新时间；
- 占位页：
  - Sandboxes；
  - Packages；
  - Gateway；
  - Settings。

## 5. 安全边界

PWA host：

- 只绑定 `127.0.0.1`；
- 不监听 LAN；
- 提供 CSP：`default-src 'self'`；
- 拒绝路径逃逸；
- 只有 `/v1/*` 会转发到控制面；
- 浏览器不接触 bearer token；
- service worker 不缓存 `/v1/*` 响应。

生产化前置：

- 同源 CSRF/Origin 校验；
- 明确 token/peer credential 策略；
- 写操作二次确认；
- 软件包安装/更新权限确认；
- workspace 挂载变更审计；
- PWA host 与 control-plane 的服务安装/升级流程。

## 6. 后续页面

### T6.3 只读面板

- sandbox list/info/stats（经 broker client）；
- agent/adapter health；
- workspace 授权列表。

### T6.4 软件包与安装/更新

- 包目录；
- 版本/来源/checksum；
- 显式确认；
- 后台 job + 进度；
- 日志与回滚入口。

### T6.5 Workspace 授权

- 宿主叶子目录选择；
- 只读/读写；
- 控制面校验 + broker 强制；
- 审计记录。

### T6.6 Agent 对话

- 会话列表；
- 聊天；
- 任务提交；
- 报告/产物下载。

### T6.7 Gateway

- Feishu 配置；
- 连接状态；
- capability 展示；
- 不向 agent 暴露 secret。

## 7. 当前验证

```text
pnpm pwa:build  ✓
```

smoke test：

```text
GET http://127.0.0.1:8787/v1/health   ✓
GET http://127.0.0.1:8787/v1/snapshot ✓
GET http://127.0.0.1:8787/            ✓
```
