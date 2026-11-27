# Sandboxes 页面与容器创建

> 状态：v1
> 代码：`apps/pwa/src/App.vue`、`apps/pwa/src/api.ts`

## 1. 设计

Sandboxes 页面现在支持创建 sandbox：

```text
Sandboxes → 新建 Sandbox
```

创建表单包括：

- 名称：必须以 `sbx-` 开头；
- 角色：utility/main/worker/observer/standalone；
- agentId；
- 镜像预设或自定义镜像；
- 网络：egress/none；
- 启动命令；
- 可选：绑定 Workspaces 页面已授权的项目目录；
- CPUs/Memory/PIDs。

提交后调用：

```text
POST /broker/v1/sandboxes
```

broker 负责创建固定目录、调用 Docker、写 registry/audit。

## 2. 默认值来源

镜像预设和默认资源来自：

```text
Packages → Sandbox 镜像与默认资源
```

包括 Node/Ubuntu/Debian/Alpine/Python 和自定义镜像。

## 3. 启动命令

默认：

```text
sleep infinity
```

它只让容器保持运行，方便验证挂载、进入容器安装 agent 或观察日志。

如果镜像内已经有 agent，可以改为真实启动命令，例如：

```text
sh -lc 'exec node /opt/agent/server.js'
```

## 4. 镜像、命令与资源语义

### 启动命令

启动命令追加在镜像之后，不经过宿主 shell。

```text
sleep infinity
sh -lc "exec /opt/agent/start.sh"
```

- 留空 → 使用镜像自己的 ENTRYPOINT/CMD；
- 需要 shell 语义时显式写 `sh -lc "..."` 或 `bash -lc "..."`；
- PWA 只做 argv 解析，不展开宿主变量、glob、管道或命令替换。

### CPUs

Docker `--cpus` 配额。`1.5` 表示最多使用 1.5 个核的算力，不是占满 1.5 个物理核。

### Memory

cgroup 内存硬上限，超过会 OOM kill。Node agent 通常至少 1 GiB；构建任务建议 2–4 GiB。

### PIDs

容器内允许存在的最大进程/线程数，对应 Docker `--pids-limit`。它限制的是 Linux task 数量，不是宿主机 PID。
256 适合单个 Node agent；编译、多 worker、浏览器场景可提高到 512–2048。太小会出现 fork/resource 错误。

### 网络

- `egress` → Docker bridge，仅出站访问模型/API，不发布入站端口；
- `none` → 完全无网络。

### Workspace 与 sandbox 本地 scratch

`sandbox` 不是项目目录。sandbox 数据目录只保存 home/cache/inbox/outbox/logs
以及临时 `scratch`。容器里的 `/workspace`：

- 没有绑定项目时 → sandbox 本地 scratch，可重建；
- 选择 Workspaces 页面授权的目录时 → broker 在 realpath 校验后把它显式挂载到
  `/workspace`，项目生命周期不跟随 sandbox 删除。

worker 可以只用 `/inbox` 和 `/outbox` 完成任务；需要长期项目/worktree 的 agent
应绑定一个明确 workspace。详见 [Sandbox 生命周期](SANDBOX-LIFECYCLE.md)。

## 5. 让 sandbox 自带 agent

Sandbox 默认是空容器。要让 agent 随镜像一起出现，推荐预构建 agent 镜像，而不是在只读 rootfs 中启动时安装。

```dockerfile
FROM node:24-bookworm
RUN npm install -g your-agent-package@1.2.3
RUN useradd --create-home --uid 1000 agent
USER agent
WORKDIR /workspace
CMD ["sleep", "infinity"]
```

完整设计见 [Agent Runtime Recipes](AGENT-RUNTIME-RECIPES.md)。

当前限制：`agentId`/`role` 只是元数据，创建 sandbox 不会自动把它接入 worker 或多 agent 路由。

## 6. 在 sandbox 内执行命令

broker 新增：

```text
POST /v1/sandboxes/:name/exec
```

请求：

```json
{
  "command": ["sh", "-lc", "pwd && ls -la /workspace"],
  "cwd": "/workspace",
  "timeoutMs": 30000
}
```

语义：

- broker 是唯一持有 Docker socket 的组件；
- broker 通过固定参数调用 `docker exec`；
- 宿主 shell 不解析命令；
- 容器内命令通过显式 `sh -lc` 执行；
- 输出有大小上限，超时会被终止；
- cwd 只允许 `/workspace`、`/home/agent`、`/cache`、`/tmp`、`/outbox`、`/legacy`；
- 审计日志只记录 argv0、参数数量、cwd、退出码、超时/截断状态，不记录环境变量；
- 当前是**一次性命令执行**，不是完整 PTY 终端。

容器环境固定为：

```text
HOME=/home/agent
PATH=/home/agent/.local/bin:...
NPM_CONFIG_PREFIX=/home/agent/.local
XDG_CONFIG_HOME=/home/agent/.config
XDG_DATA_HOME=/home/agent/.local/share
XDG_CACHE_HOME=/cache
```

PWA 的每个 Sandbox 卡片现在有：

```text
安装 Agent
执行命令
复制 docker exec 命令
```

用户可以：

```text
pwd && ls -la /workspace
opencode --version
hermes --help
pi --help
dsh --version
```

## 7. 创建时预装 Agent

新建 Sandbox 表单新增 **Agent recipe** 选择：

```text
不预装（空容器）
OpenCode
dsh
Hermes Agent
Pi coding agent
```

选择 recipe 后，创建命令会变成：

```text
npm install -g --prefix /home/agent/.local <pkg>@<pinned-version>
command -v <binary>
exec sleep infinity
```

安装写入 `/home/agent/.local`（持久化 bind mount），不修改容器只读 rootfs。
容器重启后安装仍然存在。

详细 recipe 与版本见 [Agent Runtime Recipes](AGENT-RUNTIME-RECIPES.md)。

## 8. 限制

- 不自动拉取镜像；
- 不自动停止/删除/重启 container（broker API 已有，PWA 生命周期 UI 待补）；
- 当前安装发生在容器启动时，依赖 npm registry/GitHub 网络；生产环境仍推荐预构建并锁定 digest 的镜像；
- 首次安装可能较慢，hermes 可能下载受管 Python runtime；
- 创建表单可选择已授权 workspace；不选择时 `/workspace` 是 sandbox 本地 scratch；
- 文件/凭据 host mount 仍只在 Agent Migration 等受控流程中使用；
- sandbox 创建需要 broker 与 Docker/rootless Docker 可用；
- worker 当前仍运行在宿主用户空间，不会自动使用新 sandbox；
- exec 是一次性命令，不是完整交互式 PTY。

## 9. Agent 版本和二级选择

- 新建 Sandbox 时先选择一级 Runtime：Agent 或系统镜像；
- Agent 二级选择具体版本，版本可手填；
- 创建前调用 registry 校验版本，不存在时回退 latest 并提示；
- 每个 agent 保留最近 5 个成功安装版本；
- 安装目录为 `/home/agent/.agents/<agent>/<version>`，当前版本链接到 `/home/agent/.local/bin/<binary>`；
- 更多生命周期与 workspace 关系见 [Sandbox 生命周期](SANDBOX-LIFECYCLE.md)。
