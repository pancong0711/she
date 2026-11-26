# AI Agent 本机发现与容器化迁移

> 状态：T6.9 首版完成（发现、计划、显式执行、记录、PWA 页面）
> 范围：运行在用户本机的 AI agent CLI/daemon 服务
> 安全基线：不读凭据内容、不停止原进程、不执行 sudo、不请求 root

## 1. 目标

用户经常已经在本机运行 OpenCode、Claude Code、Codex、Ollama、LM Studio、vLLM 等 agent
或模型服务。SHE 提供一个可审阅的迁移工作台：

1. 发现本机运行中的已知 AI agent 服务；
2. 展示 PID、端口、工作目录和脱敏后的命令行；
3. 让用户勾选要迁移的条目；
4. 对于复用目录或只读旧目录，必须从 Workspaces 已授权列表中选择来源；未授权目录不能直接进入迁移计划。
5. 逐项选择：
   - 新建空工作空间；
   - 复用原工作目录（读写）；
   - 是否把原工作目录只读挂载到 `/legacy`；
   - 是否把已知配置/凭据目录只读挂载到容器 home；
   - 镜像、启动命令、网络和资源限制；
5. 先返回 dry-run 计划与阻断项；
6. 用户确认后，通过 sandbox broker 创建隔离容器；
7. 写迁移记录，保留原进程不动，由用户自行切换。

## 2. 页面

PWA 新增 **Agent Migration** 页面：

- 重新扫描本机；
- 显示 running / installed-only 状态；
- 显示检测端口、cwd、脱敏命令行；
- 勾选多个服务并分别配置工作空间和凭据目录；
- 全局配置镜像、命令、网络、CPU、内存和 PIDs；
- “生成迁移计划”只做校验，不产生副作用；
- “执行一键迁移”启动 allowlisted `agent-migrate` job，实时显示日志；
- 展示历史迁移记录。

## 3. Companion API

```text
GET  /api/agents/discover
POST /api/agents/migrations/plan
POST /api/agents/migrations/apply
GET  /api/agents/migrations
GET  /api/agents/migrations/:id
```

所有写操作要求：

```http
X-SHE-Local-Action: 1
```

PWA 仍通过 companion 的 loopback 地址访问；浏览器不能直接接触 broker token、Docker socket 或凭据内容。

### 3.1 发现结果

```json
{
  "platform": "linux",
  "home": "/home/user",
  "docker": { "available": true },
  "services": [
    {
      "id": "running:opencode:1234",
      "kind": "opencode",
      "name": "OpenCode",
      "running": true,
      "pid": 1234,
      "command": "opencode serve --hostname 127.0.0.1 --port 49375",
      "cwd": "/home/user/projects/demo",
      "ports": [49375],
      "containerizable": true
    }
  ],
  "credentialSuggestions": [
    {
      "agentKind": "opencode",
      "label": "OpenCode 配置目录",
      "path": "/home/user/.config/opencode",
      "exists": true
    }
  ],
  "safety": {
    "readsProcessMetadataOnly": true,
    "readsFileContents": false,
    "killsProcesses": false,
    "executesSudo": false
  }
}
```

发现阶段只读取：

- 进程元数据（`ps`/PowerShell 进程列表）；
- `/proc/<pid>/cwd` 或 best-effort alternative；
- `ss -ltnp` 的监听端口；
- 已知配置目录是否存在（`stat`，不读取文件内容）。

命令行会脱敏：token、secret、password、api-key、Bearer、常见 API key 前缀和 URL userinfo 都会变成 `<redacted>`。

## 4. 迁移计划边界

### 4.1 工作空间

来源目录必须来自 Workspaces 授权注册表：

- `reuse`：必须选择 read-write 授权；
- `new` + `/legacy`：可选择 read-only 或 read-write 授权；
- `new` 且不挂载旧目录：不需要来源授权；
- 迁移计划记录 `workspaceAuthorizationId`；
- 实际挂载仍由 broker 二次校验。

两种模式：

| 模式 | 行为 |
|---|---|
| `new` | SHE 创建新的空目录并作为 `/workspace` 读写挂载 |
| `reuse` | 原目录直接作为 `/workspace` 读写挂载 |

`new` 模式可同时把原目录只读挂载到 `/legacy`，让容器里的 agent 读取旧文件，但不允许写回。

### 4.2 明确禁止的 workspace / mount 来源

- 文件系统根目录：`/`、Windows drive root；
- 用户 home 本身；
- 受保护系统路径，例如 `/etc`、`/usr`、`/bin`、`/sbin`、`/lib`、`/boot`、
  `/dev`、`/proc`、`/sys`、`/run`、`/var/run`、`/var/lib/docker`；
- 经过 symlink 解析后落到上述路径的目录；
- 不存在、不是目录或不可识别的来源。

如果原 agent 的 cwd 是根目录，计划会直接 blocked，不会把它复用为 workspace，也不会自动改成只读根目录挂载。

### 4.3 凭据

首版只支持**配置目录**，不支持单文件挂载：

- 必须位于用户 home 内，且不能是 home 本身；
- 只读 bind mount 到容器的 `/home/agent/<相对 home 的路径>`；
- SHE 只保存路径，不读取、不复制、不回传文件内容；
- 刷新 token 需要写文件的 agent 在首版可能无法使用；后续会引入 secret broker / 可写副本策略。

用户必须显式勾选凭据目录；发现页只给出建议，不默认选中。

### 4.4 容器镜像

SHE v1 不猜测每个 agent 的安装方式。用户必须确认所选镜像包含对应 runtime，或选择
`node:22-bookworm-slim` 等基础镜像后自行在容器内安装。默认命令为 `sleep infinity`，方便先验证
挂载与容器，再接入真实 agent 启动命令。

## 5. Broker host mount 契约

`sandbox.v1` 的 `SandboxSpec` 新增可选字段：

```ts
interface SandboxHostMount {
  source: string
  target:
    | { kind: 'workspace' }
    | { kind: 'legacy' }
    | { kind: 'home'; path: string }
  readOnly?: boolean
}

interface SandboxSpec {
  // ...
  command?: string[]
  hostMounts?: SandboxHostMount[]
}
```

broker 在 Docker 前进行：

- `realpath` 解析；
- root/home/系统路径拒绝；
- 仅目录；
- `/workspace`、`/legacy` 各最多一个；
- `/legacy` 强制只读；
- home 凭据挂载必须在真实 home 内且强制只读；
- target 冲突、路径段和数量上限校验；
- 不把凭据内容写入 registry、audit 或日志。

Docker 参数使用固定目标：

```text
source workspace  -> /workspace
legacy directory  -> /legacy      ro
credential dir    -> /home/agent/<home-relative-path> ro
```

## 6. 执行与回滚

`agent-migrate` 是 companion allowlisted job：

```text
重新扫描
→ 重新构建并校验计划
→ 创建新 workspace（如需要）
→ POST broker /v1/sandboxes（每 agent 一个）
→ 写入 migration record
→ 结束
```

- 原 agent 进程不会被停止；
- 任一 sandbox 创建失败时，自动删除本次已创建 sandbox（`preserveData=true`）；
- 迁移记录位于 `${XDG_DATA_HOME:-~/.local/share}/she/migrations/<id>.json`，权限 `0600`；
- 记录只包含路径、sandbox 名、资源与安全元数据，不含凭据文件内容；
- 用户可在 Sandboxes 页面手动停止/销毁新 sandbox；原服务保持运行，便于回滚。

## 7. 配置

```text
SHE_MIGRATION_RECORD_ROOT   默认 ~/.local/share/she/migrations
SHE_MIGRATION_WORKSPACE_ROOT 默认 ~/.local/share/she/workspaces
```

## 8. 当前限制

- 只有 Linux 的进程/cwd/端口发现是完整路径；macOS cwd/端口发现降级，Windows 仅 best-effort；
- 不自动安装 agent runtime；
- 不支持单文件凭据、secret broker、动态 token 注入；
- 只读凭据对需要定期刷新 token 的 agent 不友好；
- 不自动停止或切换原服务；
- 不自动识别 Docker image 的 UID/GID 与用户目录权限差异；
- Docker 通过 `docker` 组访问时可能是 root-equivalent；SHE 不把它宣传为 rootless；
- 尚未实现 Windows launcher 与容器迁移真机验收。

## 9. 验收

首版已验证：

```text
pnpm typecheck                          ✓
pnpm test                               ✓ 61/61
pnpm pwa:build                          ✓
/api/agents/discover                    ✓
dry-run plan + root rejection           ✓
read-only credential mount plan         ✓
agent-migrate job + fake broker         ✓
migration record write/read             ✓
broker host mount policy tests          ✓
```
