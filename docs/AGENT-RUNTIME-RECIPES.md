# Agent Runtime Recipes：让 sandbox 自带 agent

> 状态：设计稿 v0.1
> 关联：`docs/SANDBOXES.md`、`docs/SANDBOX-IMAGES.md`、`docs/AGENT-MIGRATION.md`

## 1. 结论

Sandbox 默认是空容器，这是刻意设计，不是遗漏。

SHE 创建 sandbox 时只决定：

```text
镜像 + 命令 + 网络策略 + cgroup 资源 + 受约束挂载
```

它不会在容器启动时向 rootfs 执行 `apt install` / `npm install`，原因：

- broker 以 `--read-only` 启动容器，运行期安装会失败或污染镜像层；
- 每次启动联网安装不可复现，且受 registry/网络/版本漂移影响；
- 自动猜测 agent 包名、版本和启动参数会形成不可审计的供应链边界；
- 模型/飞书凭据不应被写进镜像。

正确方向是 **Agent Runtime Recipe**：预先构建一个版本锁定、可校验的 agent 镜像，sandbox 只消费该镜像。

```text
Recipe 定义
  → 构建/校验镜像（固定 digest）
  → Sandboxes 选择镜像
  → broker 用受限参数创建容器
  → agent 通过 workspace / inbox / outbox 与 SHE 交互
```

## 2. 基础镜像怎么选

| 基础镜像 | 有 bash | 有 Node/npm | 有 git/curl | 适用性 |
|---|---:|---:|---:|---|
| `node:24-bookworm` | 是 | 是 | 是（full 镜像） | 推荐作为 Node agent 的预构建基底 |
| `node:24-bookworm-slim` | 是 | 是 | 通常没有 | 可做小镜像，但 Dockerfile 要补工具 |
| `ubuntu:24.04` | 是 | 否 | 需安装 | 通用 Linux / 非 Node agent；Node 需自行安装 |
| `debian:bookworm-slim` | 是 | 否 | 通常没有 | 轻量通用基底 |
| `alpine:3.20` | 默认只有 `sh`/busybox | 否 | 否 | 只有明确适配 musl 的 recipe 才用 |
| `python:3.12-slim` | 是 | 否 | 需安装 | Python agent 基底 |

所以：

- 不是“必须 Ubuntu”才能跑 agent；
- Node agent 用 **Node full** 通常比 Ubuntu 更省事；
- slim 镜像不是“没有 bash”，但可能缺 git/curl/编译工具；
- Alpine 的主要风险不是“没有 npm”，而是默认无 bash、musl/glibc 不兼容以及包管理差异。

## 3. Recipe schema（建议）

```ts
interface AgentRuntimeRecipe {
  schema: 1
  id: string                    // e.g. opencode
  version: string               // semver，不放 latest
  displayName: string
  baseImage: string             // 必须能解析到 digest
  imageDigest?: string          // sha256:...
  build: {
    dockerfile: string          // 仅构建期执行
    contextFiles?: Record<string, string>
  }
  runtime: {
    command: string[]           // 容器启动命令
    user?: string               // 非 root
    env?: Record<string, string>
    healthcheck?: string[]      // 可选
  }
  mounts: {
    workspace: 'rw'
    credentials: 'ro' | 'none'
    legacy?: 'ro'
  }
  network: {
    mode: 'none' | 'egress'
    allowedHosts?: string[]     // 将来由 egress proxy 强制
  }
  resources: {
    cpus: number
    memoryMb: number
    pids: number
  }
  credentialPolicy: {
    storage: 'user-file' | 'sandbox-home-ro' | 'none'
    secretInImage: false
  }
}
```

首版可以先只实现“静态 recipe 目录 + 生成 Dockerfile + 复制/构建说明”，不要声称已经一键安装任意 agent。

## 4. 当前已实现：创建时 bootstrap 到 writable home

当前版本采用“预构建镜像优先，创建时 bootstrap 作为可用折中”的方式。

Sandbox 表单可选择以下固定版本 recipe：

| Agent | npm 包 | 固定版本 | binary | 基础镜像 |
|---|---|---|---|---|
| OpenCode | `opencode-ai` | `1.19.6` | `opencode` | `node:24-bookworm` |
| dsh | `@deepseek-ai/dsh` | `0.2.2-rc.5` | `dsh` | `node:24-bookworm` |
| Hermes Agent | `hermes-agent` | `0.23.4` | `hermes` | `node:24-bookworm` |
| Pi coding agent | `@mariozechner/pi-coding-agent` | `0.73.1` | `pi` | `node:24-bookworm` |

安装命令只在容器内执行，并写入可写 bind mount：

```text
/home/agent/.local
```

不会写入只读 rootfs。容器命令：

```sh
npm install -g --prefix /home/agent/.local <pkg>@<version>
command -v <binary>
exec sleep infinity
```

这解决了“创建完 sandbox 里面没有 agent”的即时需求，同时保持：

- 版本固定；
- 不使用 `latest`；
- 不在宿主执行；
- 不接触宿主凭据；
- 安装和验证结果可通过 broker exec 审计；
- 镜像仍是最终可替换的 recipe 载体。

生产级方案仍应把同样的安装步骤固化到 Docker image，并锁定 image digest。

## 5. 预构建镜像示例

```dockerfile
FROM node:24-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 必须锁定 agent 版本；此包名和版本需由 recipe 维护者审核
RUN npm install -g your-agent-package@1.2.3

RUN useradd --create-home --uid 1000 agent
USER agent
WORKDIR /workspace

CMD ["sleep", "infinity"]
```

构建：

```sh
docker build -t she-agent-example:1.2.3 .
docker image inspect she-agent-example:1.2.3 --format '{{index .RepoDigests 0}}'
```

首次使用时用户在 Sandboxes 选择 `she-agent-example:1.2.3`，或填 `名称@sha256:<digest>`。
`docker digest` 比 tag 更适合作为生产默认值。

## 6. 可选：受审计的一键构建

如果后续要让 PWA 生成镜像，应由 broker 而不是 companion 执行 Docker：

1. 用户选择 recipe 并确认构建；
2. companion 把 recipe 和 Dockerfile 交给受信 broker job；
3. broker 创建临时 build context，仅允许 recipe 白名单内指令；
4. 构建结束后返回本地 image ID/digest；
5. 用户确认后才把新镜像用于 sandbox；
6. 构建日志、退出码、镜像名和 digest 进入审计记录；
7. 失败不覆盖现有镜像，不自动删除用户已有镜像。

这一阶段仍需：

- 锁定基础镜像 digest；
- 锁定 npm/PyPI 包版本；
- 可选 registry mirror；
- 网络代理/白名单；
- SBOM/漏洞扫描；
- 失败回滚；
- 不在 build args 中放 secret。

## 7. 与 worker 的关系

当前：

```text
core worker（宿主进程） → 外部 OpenCode HTTP 服务 → workspace
```

Sandbox 是独立执行环境，尚未被 worker 自动接管。因此：

- `agentId` / `role` 目前只是 sandbox 元数据；
- 创建 sandbox 不会自动产生一个可路由 agent；
- 把 agent 放进 sandbox 后，还需要 Task.targetAgentId、worker target filter、agent registry/health 和路由策略；
- 在这些实现前，Sandboxes 只适合准备环境、验证挂载/网络/资源，不能宣称“已加入多 agent 工作流”。

路线：

```text
Agent Runtime Recipe
  → sandbox 中运行 agent server
  → agent registry 注册
  → control/worker 按 targetAgentId 路由
  → 任务状态、预算、fanout、artifact 回到 SHE
```

## 8. 验收

- [x] Node full / Ubuntu / slim / Alpine 的 shell/工具差异有文档；
- [x] 四种 agent 的固定版本 recipe 与 sandbox exec；
- [x] 安装到 `/home/agent/.local`，不写只读 rootfs；
- [x] PWA 创建时选择 recipe、卡片内安装/验证/执行命令；
- [ ] image digest 锁定与预构建镜像发布；
- [ ] 新增 recipe 不需要修改 broker 核心逻辑；
- [ ] 镜像必须可追溯到固定 digest；
- [ ] secret 不进入 Dockerfile、build args、镜像层或日志；
- [ ] sandbox 仍使用 broker 的固定路径和受限挂载；
- [ ] 创建失败不留下半成品容器或目录；
- [ ] 不自动猜测未知 agent 的安装包/版本/启动命令。
