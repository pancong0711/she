# Sandbox Broker 与 Docker provider

> 日期：2026-11-25
> 状态：M3 完成（T3.1–T3.5）
> 代码：
> - `packages/sandbox-sdk/src/index.ts`
> - `packages/client/src/broker-client.ts`
> - `apps/broker/src/server.ts`
> - `apps/broker/src/service.ts`
> - `apps/broker/src/docker-runtime.ts`
> - `apps/broker/src/registry.ts`
> - `apps/broker/tests/broker.spec.ts`

## 1. 信任边界

broker 是唯一允许持有 Docker 控制能力的 SHE 组件：

```text
SHE control plane / CLI / PWA
        │ sandbox provider protocol
        ▼
she-broker daemon
        │ Docker socket（仅 broker）
        ▼
Docker/rootless daemon
        │
        ▼
sandbox containers
```

agent 容器：

- 不挂 Docker socket；
- 不挂 broker socket；
- 不挂宿主 home/父目录；
- 只拿到固定 workspace、inbox、outbox、home、cache 叶子挂载。

## 2. 固定目录模板

```text
$XDG_DATA_HOME/she/sandboxes/<sandbox-name>/
  workspace/     # agent 唯一业务数据目录
  inbox/         # broker 写，容器内只读
  outbox/        # agent 写，broker/控制面读取
  home/          # agent 用户态配置
  cache/         # 可丢弃缓存
  logs/
  sandbox.json   # descriptor，0600
```

默认模板下，调用方不能指定任意宿主路径或 Docker 参数。

### 2.1 显式 host mount（v1 扩展）

迁移工作台需要把用户明确选择的宿主机目录交给 sandbox，因此 `SandboxSpec` 增加受约束的
`hostMounts` 和 `command`：

```ts
interface SandboxHostMount {
  source: string
  target:
    | { kind: 'workspace' }
    | { kind: 'legacy' }
    | { kind: 'home'; path: string }
  readOnly?: boolean
}
```

broker 会先 `realpath` 再校验：

- 拒绝文件系统根目录、用户 home 本身和受保护系统路径；
- source 必须是已存在的目录；
- `/workspace` 和 `/legacy` 各最多一个；
- `/legacy` 强制只读；
- home target 只能位于真实 home 内，且首版强制只读；
- target 不允许冲突或逃逸；
- 参数数量/长度有上限；
- 不会把 source 文件内容写入 registry、audit 或日志。

这不是“任意 host mount”接口：只能替换 workspace、增加一个 `/legacy` 只读目录，或把 home
内配置目录只读镜像到 `/home/agent` 下。全部仍由 broker 唯一调用 Docker。

## 3. Docker Runtime

`DockerRuntime` 是 broker 内部的可注入接口：

```ts
interface DockerRuntime {
  health(): Promise<{ ok: boolean; version?: string; detail?: string }>
  createContainer(spec: DockerContainerSpec): Promise<void>
  start(containerName: string): Promise<void>
  stop(containerName: string): Promise<void>
  restart(containerName: string): Promise<void>
  removeContainer(containerName: string): Promise<void>
  removeNetwork(networkName: string): Promise<void>
  inspect(containerName: string): Promise<DockerInspectResult>
  stats(containerName: string): Promise<SandboxStats | undefined>
}
```

`DockerCliRuntime` 固定 command-line 模板：

- `--read-only`
- `--cap-drop ALL`
- `--security-opt no-new-privileges`
- `--network none|bridge`
- workspace `rw`（host mount 时可按显式只读设置）
- 可选受约束 host mounts 与容器 command
- inbox `ro`
- outbox `rw`
- home/cache 固定叶子挂载
- `--tmpfs /tmp`
- CPU/memory/pids 限额
- label `she.sandbox` / `she.role`

测试使用 `FakeDocker`，不要求真实 Docker。

## 4. Broker HTTP API

Unix socket + HTTP/JSON：

```text
GET    /v1/health
GET    /v1/sandboxes
POST   /v1/sandboxes
GET    /v1/sandboxes/:name
GET    /v1/sandboxes/:name/stats
POST   /v1/sandboxes/:name/start
POST   /v1/sandboxes/:name/stop
POST   /v1/sandboxes/:name/restart
POST   /v1/sandboxes/:name/messages
DELETE /v1/sandboxes/:name?preserveData=true|false
```

- 默认不监听 TCP/LAN；
- socket 0600；
- 目录 0700；
- 可选 Bearer token；
- 所有业务响应使用 `Result<T>`；
- broker error 会映射为 `SheError`，并保留 `details.brokerCode`。

## 5. 生命周期

- `create()` 创建固定目录、写 descriptor、调用 Docker create；
- `start/stop/restart` 只操作已注册 sandbox；
- `destroy({preserveData:true})` 删除容器但保留数据；
- `destroy({preserveData:false})` 删除容器并删除 sandbox 根目录；
- registry 原子写入 `registry.json`；
- 所有写操作追加 `audit.jsonl`；
- 服务重启后从 registry 恢复 sandbox 列表。

## 6. inbox/outbox 路由

`sendMessage()`：

1. 校验 `rootTaskId`、messageId、sandbox 存在；
2. 校验 actor 权限：
   - main actor 默认可向 `allowedCallers` 包含 `main` 的 sandbox 发消息；
   - worker 必须同时满足 target.allowedCallers 和 sender.allowedTargets；
3. 目标 `inbox/<messageId>/input/` 必须尚不存在；
4. artifact 源只能来自发送方 outbox；
5. `as`/`fromOutbox` 必须是安全相对路径；
6. `realpath` 后必须仍在发送方 outbox 内，拒绝 symlink 逃逸；
7. 写入文件 0600，记录 sha256、bytes；
8. 写 `manifest.json`（0600）；
9. 记录 audit。

拒绝：

- `../x`；
- 绝对路径；
- symlink 逃逸；
- 跨 sandbox outbox 引用；
- 未授权 sender；
- message id 重复。

## 7. Client

`@she/client` 新增：

```ts
const broker = new SandboxBrokerClient({ socketPath, token })
await broker.health()
await broker.list()
await broker.create(spec)
await broker.start(name)
await broker.stop(name)
await broker.restart(name)
await broker.stats(name)
await broker.sendMessage(message)
await broker.destroy(name, { preserveData: true })
```

client 只依赖 `@she/protocol` + Node 标准库。

## 8. 测试覆盖

- 固定路径创建与 descriptor；
- list/inspect/stats；
- start/stop/restart/destroy；
- registry 重启恢复；
- audit 文件写入；
- main→worker 和 worker→worker 消息；
- inbox manifest / sha256 / input 文件；
- 路径逃逸、symlink 逃逸、未授权 sender 负例；
- Unix socket server + client 完整调用。

当前测试：`pnpm test` **61/61**（包含 host mount 正例/根目录与可写凭据负例）。

## 9. 已知限制

- `DockerCliRuntime` 尚未在全平台真机验收；
- SHE 不请求 root，也不自行初始化 rootless Docker；
- 使用当前用户可访问的 Docker context；若依赖 docker 组，preflight 会提示 root-equivalent 风险；
- 已由用户/管理员配置好的 rootless Docker 可直接使用；
- 事件订阅 `subscribe()` 目前为空实现，后续补 broker event stream；
- 资源限额/挂载模板需要真机安全验收；
- host mount 首版只支持目录，不支持单文件凭据或隐藏路径；
- 文件传输暂只支持 outbox 文件和文本 manifest，artifact 共享卷后续补；
- 多 broker 实例共享同一 registry/数据根不支持。

## 10. 运维命令草案

```text
she broker doctor
she broker sandboxes
she broker inspect <name>
she broker stats <name>
she broker start|stop|restart <name>
she broker destroy <name> [--purge --yes]
she broker audit [--tail <n>]
```

`destroy --purge` 必须显式确认；默认保留 workspace/inbox/outbox/home/cache。
