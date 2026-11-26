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

## 4. 镜像与 agent runtime

SHE 不会猜测 agent 的 npm/PyPI 包名和启动参数。

若要自动安装，需要后续实现受审计的 **Agent Runtime Recipe**：

- 固定镜像 digest；
- 固定 package/version；
- 安装命令和校验；
- 启动命令；
- 凭据注入方式；
- 失败回滚。

当前用户需要选择已包含 runtime 的镜像，或自行在容器内安装。

## 5. 限制

- 不自动拉取镜像；
- 不自动停止/删除 container；
- 不自动安装 agent；
- 首版创建表单不配置文件/凭据/workspace host mount；
- sandbox 创建需要 broker 与 Docker/rootless Docker 可用。
