# Sandbox 生命周期、Agent 版本与 Workspace 关系

## 1. Sandbox 不是 Workspace

两者是不同层，生命周期也应当分开：

```text
Sandbox   = 可重建的执行环境 + 运行时存储
Workspace = agent 长期负责、用户显式授权的项目目录
```

一个 sandbox 的运行时存储通常是：

```text
~/.local/share/she/sandboxes/<sandbox-name>/
  scratch/      # sandbox 本地临时工作区，挂载到容器 /workspace（不是用户项目）
  inbox/        # 入站消息，只读挂载到 /inbox
  outbox/       # 出站文件，读写挂载到 /outbox
  home/         # agent HOME 持久化目录，挂载到 /home/agent
  cache/        # npm/构建缓存，挂载到 /cache
  logs/
  sandbox.json  # descriptor
```

其中：

- `scratch` 是可重建的临时工作区，不是长期项目，也不应被当作 agent 的 workspace；
- `home` 是 agent CLI/runtime、配置和会话状态（例如 `/home/agent/.agents`）；
- `inbox/outbox` 是跨 sandbox 消息/文件路由；
- `cache` 是可丢弃的缓存；
- `sandbox.json` 是 broker registry 的元数据。

长期项目必须来自用户授权的宿主机目录，并通过 broker 显式挂载：

```text
已授权 read-write 目录 -> /workspace
已授权 read-only 目录  -> /legacy（迁移/参考）
```

因此：

- 删除或重建 sandbox 不等于删除用户项目；
- 外部 workspace 的生命周期由用户管理，不由 `docker rm` 决定；
- worker 可以完全不用 workspace，只通过 inbox/outbox 接收任务和交付结果；
- main 或长期 worktree agent 推荐绑定一个明确的 workspace；
- 当前 Sandboxes 创建表单允许选择已授权 workspace；不选择时 `/workspace` 是 sandbox 本地 scratch。

## 2. stop / restart / destroy 的含义

### stop

```text
docker stop
```

- 容器停止；
- registry、sandbox 目录、workspace、home、agent 安装版本全部保留；
- 可以再次 start；
- 不是删除。

### start

```text
docker start
```

- 重新启动同一个容器；
- 使用原有主命令；
- 保留 workspace/home。

### restart

```text
docker restart
```

- stop + start 同一个容器；
- 不删除数据；
- 不改变镜像和主命令。

### destroy

```text
docker rm
```

- 删除容器；
- 默认 `preserveData=true` 时保留 sandbox 数据目录；
- 只有显式 `preserveData=false` 才删除数据目录；
- 会从 broker registry 移除 sandbox；
- 这是“删除 sandbox”的动作。

## 3. 升级 Agent 版本

### 不推荐：删 sandbox 再建一个

会丢失容器状态、运行中进程和 sandbox 名称，除非显式迁移数据。

### 推荐：同一 sandbox 安装新版本

Agent recipe 现在把每个版本安装到：

```text
/home/agent/.agents/<agent>/<version>/
```

并把当前版本链接到：

```text
/home/agent/.local/bin/<binary>
```

因此：

```text
安装 opencode@2.3.2
安装 opencode@2.4.2
```

两个版本可以同时存在于同一 sandbox 的持久化 home。
把 current symlink 指向新版即可切换，无需删除 sandbox。若 agent 使用外部
workspace，项目目录也不受 sandbox 升级/重建影响。

> 当前 UI 的“安装 Agent”会把选定版本设为当前链接。
> 真正运行中的 agent server 需要重启对应的容器内进程或 sandbox。

### 新建 sandbox 的场景

当你需要：

- 不同资源配额；
- 不同网络策略；
- 不同基础镜像；
- 完全隔离的 workspace；
- 同时运行多个 agent 版本/服务

时，可以创建新 sandbox。旧 sandbox 不必删除。

## 4. Agent 版本规则

- 版本可以手动填写；
- 安装/创建前调用 registry 查询；
- 如果指定版本存在：使用指定版本；
- 如果指定版本不存在：回退到该包最新稳定版并明确提示；
- 查询不到 registry 时：使用 recipe 默认版本并标记 `registry unavailable`；
- 只有实际安装/验证成功的版本才写入成功版本列表；
- 每个 agent 默认保留最近 5 个成功版本（`~/.config/she/agent-versions.json`，0600）；
- 版本目录本身不受 5 条列表限制，列表只记录近期成功安装。

示例：

```text
agent: opencode
package: @opencode/cli
requested: 2.4.2
resolved: 2.4.2
exact: true
```

若：

```text
requested: 9.9.9
resolved: 2.4.2
fallback: true
```

## 5. 二级列表

选择器按两级组织：

```text
一级：Runtime
  - Agent: OpenCode
  - Agent: dsh
  - Agent: Hermes
  - Agent: Pi
  - 系统镜像（不预装 Agent）

二级：
  - Agent 对应具体版本，例如 2.3.2 / 2.4.2 / 已成功安装版本
  - 系统镜像对应具体 image，例如 node:24-bookworm / ubuntu:24.04
```

这样可以明确区分：

```text
“使用哪个 agent 运行时” vs “使用哪个 Docker/系统镜像”
```
