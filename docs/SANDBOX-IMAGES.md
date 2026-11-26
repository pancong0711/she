# Sandbox 镜像与默认资源

> 状态：v1
> 代码：
> - `apps/companion/sandbox-preferences.mjs`
> - `apps/companion/server.mjs`
> - `apps/pwa/src/App.vue`
> - `apps/pwa/src/components/AgentMigrationPanel.vue`

## 1. 目标

Packages 页面需要成为 sandbox runtime 的统一入口，包括：

- Docker/rootless Docker 安装；
- sandbox 镜像选择；
- 默认网络模式；
- 默认 CPU/memory/PIDs；
- 本机已有镜像检测；
- 将默认值用于 Agent Migration 新计划。

## 2. 镜像预设

当前内置：

```text
node:22-bookworm-slim
node:24-bookworm-slim
ubuntu:24.04
debian:bookworm-slim
alpine:3.20
python:3.12-slim
```

也可以输入自定义镜像。

## 3. API

```text
GET  /api/sandbox/preferences
POST /api/sandbox/preferences
```

GET 返回：

```json
{
  "path": "~/.config/she/sandbox.json",
  "config": {
    "schema": 1,
    "defaultImage": "node:22-bookworm-slim",
    "networkMode": "egress",
    "resources": { "cpus": 1, "memoryMb": 1024, "pids": 256 }
  },
  "catalog": [...],
  "localImages": ["node:22-bookworm-slim"]
}
```

写操作要求 `X-SHE-Local-Action: 1`，配置写入 0600。

`localImages` 来自：

```bash
docker images --format '{{.Repository}}:{{.Tag}}'
```

不自动执行 `docker pull`。

## 4. PWA

Packages → Sandbox 镜像与默认资源：

- 镜像下拉菜单；
- 自定义镜像输入；
- 默认网络；
- CPU/memory/PIDs；
- 本机是否已有镜像；
- 显示 `docker pull <image>` 命令；
- 保存默认配置。

Agent Migration 打开时读取这些默认值，用户仍可对单次计划覆盖。

## 5. 限制

- 下拉菜单只设置默认值，不负责拉取镜像；
- 镜像是否包含具体 agent runtime 仍由用户确认；
- image digest 锁定、镜像扫描和权限验证尚未实现；
- 未与 sandbox broker 的 image allowlist 绑定；
- 多 agent 分发需要后续 target-agent 路由。
