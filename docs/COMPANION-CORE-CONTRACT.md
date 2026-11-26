# Companion ↔ Core 契约 v1

> 日期：2026-11-25
> 状态：T7.2 / T7.3 已实现
> 关联：`ADR-0001-companion-core-split.md`
> 代码：
> - `apps/companion/server.mjs`
> - `run-core.sh` / `run-core.cmd` / `run-core.mjs`
> - `scripts/release-manifest.mjs`

## 1. 目标

把稳定层和高频更新的 core 分开：

```text
PWA / gateway adapter
        │ companion-api.v1
        ▼
she-companion（稳定）
        │ run-core
        ▼
she-core bundle（可替换）
```

companion 不 import core/control/broker 内部；core 不负责更新自己。

## 2. Companion API v1

本地只绑定 `127.0.0.1`，默认端口 `8787`。

### 2.1 基础

```text
GET /api/health
GET /api/version
GET /api/capabilities
GET /api/core/status
GET /api/preflight
GET /api/platform
POST /api/core/start
POST /api/core/stop
POST /api/core/restart
POST /api/core/update/check
POST /api/core/update/apply-job (via /api/jobs kind=core-update)
GET  /api/worker/config
POST /api/worker/config
GET  /api/agents/discover
POST /api/agents/migrations/plan
POST /api/agents/migrations/apply
GET  /api/agents/migrations
GET  /api/agents/migrations/:id
```

`/api/health` 返回 companion 自身信息：

- pid；
- repoRoot；
- PWA distDir；
- control/broker socket；
- activeJobId；
- version。

`/api/version`：

```json
{
  "companion": "0.1.0",
  "node": "v22.x",
  "repoRoot": "...",
  "distDir": "...",
  "protocols": {
    "companionApi": "v1",
    "gateway": "v1",
    "agent": "v1",
    "sandbox": "v1"
  }
}
```

`/api/capabilities`：

- 支持的 jobs；
- 支持的 API；
- streaming 类型；
- 安装能力声明。

`/api/preflight`：返回最近一次环境检查结果；`install` job 会先强制执行同一组检查，存在 fail 时中止。

`/api/platform`：返回 OS/arch/Node/shell/uid/WSL、Docker mode、capability 与跨平台支持矩阵；未验证平台明确标记。

`/api/core/status`：

- companion 主动探测 control-plane `/v1/health`；
- companion 主动探测 broker `/v1/health`；
- 返回 reachable/httpStatus/response/error，不伪造状态。

### 2.2 API 代理

```text
/v1/*         → control-plane Unix socket
/broker/v1/*  → sandbox broker Unix socket
```

- 浏览器不接触 token；
- companion 从本地 token 文件读取并注入；
- CORS 只允许明确配置的 origin；
- 支持 preflight 和 Private Network Access；
- 只绑定 loopback。

### 2.3 Jobs

```text
GET  /api/jobs
POST /api/jobs
GET  /api/jobs/:id
GET  /api/jobs/:id/events
```

`POST /api/jobs` body：

```json
{ "kind": "doctor" }
```

允许 kind：

```text
doctor
bootstrap
install
build
build-all
test
core-update
agent-migrate
```

`agent-migrate` 的 body 是迁移请求，companion 会重新扫描并校验计划后才通过 broker 创建 sandbox；
原始凭据内容不会进入 job 输入、日志或迁移记录。

约束：

- 不接受任意 command；
- 写请求要求 `X-SHE-Local-Action: 1`；
- 跨域写请求必须通过 CORS preflight；
- 同时只允许一个 active job；
- events 为 NDJSON；
- 只把 stdout/stderr/system/check/status/done 作为纯文本事件。

## 3. run-core 契约

core bundle 根目录必须提供：

```text
run-core.sh
run-core.cmd
```

companion 只调用该入口，不硬编码：

```text
node apps/control-plane/dist/main.js
pnpm ...
具体 CLI 子命令
```

当前仓库的参考入口：

- `run-core.sh` / `run-core.cmd`；
- `run-core.mjs` 启动 control-plane 与 broker；
- 使用环境变量覆盖内部入口：

```text
SHE_CONTROL_PLANE_ENTRY
SHE_BROKER_ENTRY
SHE_CORE_SKIP_CONTROL_PLANE
SHE_CORE_SKIP_BROKER
```

### 3.1 生命周期

- companion 启动 run-core；
- run-core 负责启动并监督 control-plane/broker；
- 任一子进程异常退出，run-core 退出并让 companion 显示失败；
- companion 停止时发送 SIGTERM；
- run-core 转发信号并等待子进程退出；
- 更新过程中 companion 先停 run-core，再切换版本。

## 4. Release manifest v1

由：

```sh
node scripts/release-manifest.mjs --bundle she-core-0.1.0.tar.gz --out release-manifest.json
```

生成。

Schema：

```json
{
  "schema": 1,
  "name": "she",
  "version": "0.1.0",
  "commit": "<git sha>",
  "generatedAt": "<iso>",
  "protocols": {
    "companionApi": "v1",
    "gateway": "v1",
    "agent": "v1",
    "sandbox": "v1"
  },
  "entrypoint": {
    "posix": "run-core.sh",
    "windows": "run-core.cmd",
    "args": []
  },
  "bundle": {
    "file": "she-core-0.1.0.tar.gz",
    "bytes": 123,
    "sha256": "..."
  }
}
```

约束：

- manifest 只包含稳定元数据；
- bundle SHA-256 必填；
- version/commit 必须对应；
- protocol major 不兼容时必须显式拒绝；
- companion 不根据 package-lock 猜测兼容性，必须读 manifest/capability。

## 4.1 Core bundle 构建与安装

构建：

```sh
pnpm build:core
# 或
bash scripts/build-core-bundle.sh
```

输出：

```text
artifacts/core/
  she-core-0.1.0/
    control-plane.mjs
    broker.mjs
    run-core.sh
    run-core.cmd
    run-core.mjs
    VERSION
    bundle.json
    LICENSE
  she-core-0.1.0.tar.gz
  release-manifest.json
```

安装到用户级版本目录：

```sh
bash scripts/install-core-bundle.sh artifacts/core/she-core-0.1.0.tar.gz \
  --sha256 <manifest.bundle.sha256> \
  --core-root ~/.local/share/she/core
```

布局：

```text
~/.local/share/she/core/
  versions/
    0.1.0/
  current -> versions/0.1.0
  previous -> versions/<旧版本>
  state.json
  staging/
```

`install-core-bundle.sh`：

- 拒绝以 root 运行；
- 可校验 SHA-256；
- 安装到用户目录；
- 不启动/停止进程；
- 同一版本默认不覆盖，需 `--force`；
- 进程切换与回滚在 T7.5 实现。

实测：

- core bundle 成功打包；
- bundle 内 `run-core.sh` 成功同时启动 control-plane 与 broker；
- 两个 socket `/v1/health` 均返回 200；
- 版本目录与 `current` symlink 安装验证通过。

## 5. 更新状态机（已实现）

```text
idle
  → checking
  → downloading
  → verifying
  → pending
  → stopping-old
  → switching
  → starting-new
  → health-checking
  → succeeded
       ↘ failed → rolling-back → rolled-back
```

实现：

- `POST /api/core/update/check` 获取 manifest 并比较当前版本；
- `POST /api/jobs { kind: "core-update", manifestUrl }` 执行更新；
- 下载到 `coreRoot/staging/`；
- SHA-256 不匹配立即失败；
- 写 `pending.json`；
- 停止当前 core；
- 调用用户级 `install-core-bundle.sh`；
- 启动新 core；
- 等 control-plane + broker 都可达；
- 任一步失败则切回 `previous` 并启动旧 core；
- 结果通过 job NDJSON 实时推送给 PWA。

已验证：

- 0.1.0 → 0.1.1 成功切换；
- 故意提供启动失败的 0.1.2 bundle → health check 失败 → 自动回滚到 0.1.0 并恢复健康。

## 6. 当前实现边界

已完成：

- `apps/companion` 从 PWA host 抽出；
- companion 不 import core；
- `/api/health`、`/api/version`、`/api/capabilities`、`/api/core/status`；
- `/v1/*` 与 `/broker/v1/*` 代理；
- allowlisted jobs 与实时 NDJSON；
- `run-core` 参考入口；
- release manifest 生成器。

已完成：

- core bundle 打包脚本；
- current/previous 版本目录；
- staging/pending/自动切换与回滚；
- companion 启停/重启 run-core；
- PWA 更新 UI；
- checksum-verified companion installer；
- companion release manifest。

未完成：

- companion 自身在线自更新（明确不做：PWA 不替换运行中的 companion）；
- Windows 原生 companion 安装路径的完整真机验收；
- 平台级 signed artifact / OS code signing；
- Docker/rootless 系统 runtime 安装（保持 instructions-only）。
