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
- Docker Hub 官方源与第三方镜像代理选择；
- 默认网络模式；
- 默认 CPU/memory/PIDs；
- 本机已有镜像检测；
- 将默认值用于 Agent Migration 新计划。

## 2. 镜像预设

当前内置：

```text
node:24-bookworm        # 推荐 agent 基础镜像（Node/npm/bash/git/curl）
node:22-bookworm        # 兼容性优先的 Node full
node:24-bookworm-slim
node:22-bookworm-slim
ubuntu:24.04            # bash/apt 完整，但不预装 Node
debian:bookworm-slim
alpine:3.20             # 默认 sh/busybox；agent 需明确适配
python:3.12-slim
```

也可以输入自定义镜像。完整 shell/工具差异和外置 agent 镜像方案见
[Agent Runtime Recipes](AGENT-RUNTIME-RECIPES.md)。

### 2.1 镜像源

Sandbox 创建表单和 Packages 默认镜像配置都支持镜像源下拉：

```text
Docker Hub 官方源
DaoCloud 镜像代理（docker.m.daocloud.io）
1ms.run 镜像代理（docker.1ms.run）
1Panel 镜像代理（docker.1panel.live）
```

镜像源是“镜像引用重写”，不是 Docker daemon 全局配置。选择镜像代理后：

```text
node:24-bookworm
  → docker.m.daocloud.io/library/node:24-bookworm

some-user/agent:1.0
  → docker.m.daocloud.io/some-user/agent:1.0
```

`ghcr.io/...`、`localhost:5000/...` 等已经带 registry 的引用保持不变，
因为 Docker Hub 镜像代理无法代理其他 registry。第三方镜像源可能缓存、限流
或改变镜像内容；敏感环境应使用官方源、私有 registry 或锁定 digest。

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
    "imageSource": "official",
    "networkMode": "egress",
    "resources": { "cpus": 1, "memoryMb": 1024, "pids": 256 }
  },
  "catalog": [...],
  "imageSources": [
    { "id": "official", "label": "Docker Hub 官方源", "registryPrefix": null },
    { "id": "daocloud", "label": "DaoCloud 镜像代理", "registryPrefix": "docker.m.daocloud.io" }
  ],
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
- 镜像源下拉菜单；
- 自定义镜像输入；
- 默认网络；
- CPU/memory/PIDs；
- 本机是否已有镜像；
- 显示解析后的实际镜像和 `docker pull <实际镜像>` 命令；
- 保存默认镜像源。

Agent Migration 打开时读取这些默认值，用户仍可对单次计划覆盖。

## 5. 限制

- 下拉菜单只设置默认值和解析规则，不负责拉取镜像；
- 镜像源重写只对 Docker Hub 引用生效；
- 镜像是否包含具体 agent runtime 仍由用户确认；
- image digest 锁定、镜像扫描和权限验证尚未实现；
- 未与 sandbox broker 的 image allowlist 绑定；
- 多 agent 分发需要后续 target-agent 路由；
- 运行期 `apt/npm` 安装不适合作为常规 agent 预装方式；使用预构建镜像。


## 受限网络 fallback

当 Docker Hub 和 registry 代理都不可用时，可使用清华 TUNA Ubuntu base rootfs 导入并构建本地 Node 镜像。完整测试与步骤见 `docs/SANDBOX-IMAGE-FALLBACKS.md`，脚本为 `scripts/build-sandbox-fallback-image.sh`。
