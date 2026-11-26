# SHE companion 0.4.8 发布说明

> Release：`v0.4.8-companion.1`
> 日期：2026-11-26

## 新增

- Sandboxes / Agent Migration 容器设置说明：
  - 启动命令是镜像后的 argv，不经过宿主 shell；
  - `CPUs 1.5` 表示最多 1.5 个核的算力配额；
  - PIDs 是 Docker `--pids-limit` 的容器内最大进程/线程数；
  - `egress` 是 Docker bridge 出站网络，不发布入站端口；
  - 角色/agentId 目前只是 sandbox 元数据，不自动建立 worker 路由。
- 修复 PWA 启动命令解析：
  - 支持单/双引号和反斜杠；
  - `sh -lc 'exec ...'` 现在会把整个脚本作为单个参数传给 `sh`；
  - 未闭合引号会给出明确错误。
- Settings 增加 worker 边界说明和 Chat 快速验证入口：
  - worker 是 core 内的任务 claim loop，不在 sandbox；
  - 任务实际使用配置的宿主 workspace；
  - 当前 sandbox 不会自动成为 worker runtime。
- Gateway 增加 feishu4dsh 安装/连接向导：
  - 只读检查 `dsh`、profile、插件依赖、0600 env 文件变量名、user service；
  - 受控 `feishu4dsh-install` job 调用 `dsh plugin ... add ...`；
  - 不使用 sudo，不读取/保存/回显飞书 secret，不自动安装 systemd service。
- Sandbox 镜像预设增加 Node 24/22 full，修正 Alpine/slim/Ubuntu 的实际工具差异说明。
- 新增 `docs/AGENT-RUNTIME-RECIPES.md`：
  - 预构建 agent 镜像；
  - 固定版本/digest；
  - 运行期不在只读 rootfs 安装；
  - secret 不进入镜像；
  - 与未来 sandbox worker 路由的边界。

## 重要边界

- 安装 feishu4dsh 只完成 `飞书 ↔ feishu4dsh ↔ dsh` 通道准备；
  SHE 的 gateway.v1 adapter 仍待 feishu4dsh 侧接入和 T4.6 真机验收。
- 新建 sandbox 默认是空容器。要让 sandbox 自带 agent，应使用预构建镜像，
  而不是在运行期 `apt/npm install`。
- 当前只有一个宿主侧 OpenCode worker，多 agent/sandbox 路由尚未实现。

## 验证

```text
pnpm typecheck  ✓
pnpm test       ✓ 90/90
pnpm pwa:build  ✓
pnpm build:core ✓
pnpm build:companion ✓
```
