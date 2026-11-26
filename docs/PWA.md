# SHE PWA 本地控制台

> 日期：2026-11-25
> 状态：T6.1–T6.2 完成，GitHub Pages 部署完成，T6.3 首屏只读面板完成
> 代码：
> - `apps/pwa/`
> - `apps/companion/server.mjs`
> - `apps/pwa/src/App.vue`
> - `apps/pwa/public/manifest.webmanifest`
> - `apps/pwa/public/sw.js`

## 1. 定位

PWA 是 SHE 本地控制台的 UI，不是第二套业务系统：

```text
浏览器/PWA
  │ 同源 HTTP: http://127.0.0.1:8787
  ▼
apps/companion/server.mjs
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

## 2.1 双模式：GitHub Pages + 本地 companion

### GitHub Pages 静态 PWA

地址：

```text
https://pancong0711.github.io/she/
```

这一层是：

- 可直接安装到桌面/主屏的 PWA；
- 首次使用向导/安装说明；
- 连接本机 SHE companion 的入口；
- 连接成功后复用同一个 Dashboard/Tasks 等控制面 UI。

GitHub Pages 本身不能执行安装命令、不能访问 Docker、不能读取本地文件。它只负责 UI 和引导；真正的控制面在用户电脑上。

### 本地同源模式

```text
http://127.0.0.1:8787
```

本地 companion 同时提供：

- 静态 PWA；
- `/v1/*` 反向代理；
- 可选的 bearer token 注入。

这是完整的推荐使用方式：浏览器与 companion 同源，不需要跨域。

### 远程静态 PWA → 本地 companion

GitHub Pages 页面会检测：

```text
http://127.0.0.1:8787
```

连接流程：

```text
GitHub Pages PWA
  → fetch http://127.0.0.1:8787/v1/health
  → companion 校验 Origin
  → CORS 预检
  → 成功则显示 Dashboard/Tasks
```

companion 默认允许：

```text
https://pancong0711.github.io
http://127.0.0.1:8787
http://localhost:8787
http://127.0.0.1:5173
http://localhost:5173
```

可由 `SHE_ALLOWED_ORIGINS` 覆盖。浏览器仍不应直接接触 token；token 由 companion 侧读取并注入。

## 2.2 一键启动 launcher（对齐 assignment-assistant）

PWA 静态资源内直接提供：

```text
/start.bat       # Windows：下载并运行 start.ps1
/start.ps1       # Windows：下载、校验、安装 companion、启动并打开浏览器
/start.command   # macOS：下载并运行 start.sh
/start.sh        # macOS/Linux：下载、校验、安装 companion、启动并打开浏览器
```

用户从 PWA 点击下载后：

- Windows：双击 `start.bat`；
- macOS：双击 `start.command`；
- Linux/macOS：`bash start.sh`。

launcher 会：

1. 检查当前用户与 Node.js；
2. 从固定 GitHub Release 下载 companion manifest；
3. 下载 companion bundle；
4. 校验 SHA-256；
5. 安装到用户目录；
6. 创建 versioned `current` 和 `~/.local/bin/she-companion`；
7. 启动 companion；
8. 自动打开 `http://127.0.0.1:8787`。

launcher 不请求 root、不执行 sudo、不安装 Node/Docker。

> 浏览器安全模型不允许网页静默执行下载的程序。所谓“一键安装”仍是“网页点击下载 launcher → 用户双击/运行一次”，与 assignment-assistant 的模式一致。

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

浏览器不会接触 token；PWA host 从 `SHE_TOKEN_FILE` / `SHE_BROKER_TOKEN_FILE` 读取后注入对应代理请求。

## 4. 当前页面

已完成：

- 首次使用向导：
  - 安装/启动说明；
  - 复制本机启动命令；
  - 连接本地 companion；
  - companion URL 配置；
- Dashboard：
  - control plane health；
  - sandbox 数量/运行数；
  - gateway protocol；
  - snapshot cursor；
  - task 数量/运行数/attention 数；
  - recent tasks；
- Tasks：
  - 只读任务表；
  - 状态、摘要、priority、更新时间；
- Workspaces：
  - 叶子目录授权注册表；
  - read-only / read-write 权限意图；
  - realpath、r/w、leafAuthorized 和 warning；
- Agents：
  - OpenCode adapter health（版本/错误/checkedAt）；
  - worker 状态与最近 task/error；
  - 凭据文件只显示路径；
  - worker workspace 的 realpath、r/w/x、readOnly 和叶子目录授权状态；
- Chat：
  - 通过 `/she submit` 布置任务；
  - 实时显示 agent text delta、tool call、完成/失败；
  - worker 状态和 disabled 提示；
- Agent Migration：
  - 复用目录或只读旧目录必须选择 Workspaces 授权；
  - 扫描本机运行中的 AI agent 进程、端口和 cwd；
  - 勾选服务，配置 new/reuse workspace、`/legacy` 只读和凭据目录只读挂载；
  - dry-run 计划、根目录阻断、实时迁移 job 与历史记录；
- Sandboxes：
  - 通过 `/broker/v1/*` 代理访问 sandbox broker；
  - list/status/role/agent/image；
  - 按需加载 CPU/memory/PIDs stats；
  - broker 离线时显示启动提示；
- Packages：
  - companion/core/runtime/tooling/agent runtime 清单；
  - requirement 与用途说明；
  - 缺失依赖的安装/修复方法、复制命令和官方文档链接；
  - companion launcher、core 更新和 pnpm bootstrap 入口；
  - Node/pnpm/git/bash/curl/tar/SHA-256/Docker/OpenCode 状态；
- Settings：
  - companion URL；
  - 连接状态；
  - companion 当前版本/最低版本/supervisor 状态/install root；
  - 页面内重启、停止、检查更新和安装并重启；
- Install & Doctor 平台能力：
  - OS/arch/Node/shell/uid/WSL 与 Docker 模式；
  - Linux/macOS/Windows 支持矩阵，区分 verified / implemented-unverified / design-only / unsupported；
- Install & Doctor 环境能力摘要：
  - 区分 required toolchain 与 sandbox/Docker 能力；
  - Docker 缺失时显示可选能力影响和安装指引；
  - job 成功但存在 warning 时明确标注，避免把 `succeeded` 误解为所有能力就绪。
- Core 安装/更新（Install & Doctor 内）：
  - Core 未安装时直接显示“安装 Core”按钮；
  - current/previous 版本；
  - supervisor 状态；
  - 已安装后才启用启动/停止/重启 core；
  - manifest URL 检查；
  - staging、切换、health check、自动回滚；
  - 实时更新日志；
- 构建 PWA / 构建 TypeScript 包 / 运行测试等源码开发工具收进“开发者工具”折叠区。
- 占位页：
  - Gateway。

## 5. 安全边界

PWA host：

- 只绑定 `127.0.0.1`；
- 只允许明确的 browser origin 访问 `/v1/*`；
- 支持 CORS 预检和 Private Network Access 提示；
- 不监听 LAN；
- 提供 CSP：`default-src 'self'`；
- 拒绝路径逃逸；
- `/v1/*` 转发到 control plane；
- `/broker/v1/*` 转发到 sandbox broker；
- 两个代理都经过同一 origin/CORS 策略；
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

已完成：

- companion bundle、checksum-verified 安装器和 PWA 下载入口；
- companion 自身升级边界：PWA 不替换运行中的 companion；
- core bundle 更新闭环：manifest、SHA、staging、前后版本、健康检查和回滚；


- 本地 Install & Doctor 页面；
- allowlisted job runner；
- 实时 NDJSON 日志；
- 环境检查/依赖安装/构建/测试。

后续：

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

## 6.1 导航行为

左侧导航始终会切换 active tab。控制面/companion 离线时：

- Dashboard 显示连接/启动引导；
- Tasks/Sandboxes 显示该模块需要先启动对应服务的说明；
- Install & Doctor 仍可用（只要 PWA companion 在线）；
- Settings 始终可配置 companion URL。

如果点击后没有任何视觉变化，通常是浏览器仍在运行旧 service worker 缓存；刷新或重新安装 PWA 可更新到新版本。

## 7. GitHub Pages 部署

工作流：

```text
.github/workflows/pages.yml
```

流程：

```text
push main
  → pnpm install
  → pnpm pwa:build
  → upload apps/pwa/dist
  → deploy GitHub Pages
```

Vite 使用相对 base：

```ts
base: './'
```

因此同一份 `dist` 同时适配：

```text
https://pancong0711.github.io/she/
http://127.0.0.1:8787/
```

GitHub Pages 的 Source 必须设置为 **GitHub Actions**。

## 8. 当前验证

```text
pnpm pwa:build  ✓
```

本地 smoke test：

```text
GET http://127.0.0.1:8787/v1/health          ✓
GET http://127.0.0.1:8787/v1/snapshot        ✓
GET http://127.0.0.1:8787/broker/v1/health   ✓
GET http://127.0.0.1:8787/broker/v1/sandboxes ✓
GET http://127.0.0.1:8787/                   ✓
GET http://127.0.0.1:8787/icons/she-512.png  ✓
```

CORS smoke test：

```text
Origin: https://pancong0711.github.io
OPTIONS /v1/health → 204 + CORS headers
GET /v1/health → 200 + Access-Control-Allow-Origin
```
