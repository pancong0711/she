# SHE companion 0.5.0 发布说明

> Release：`v0.5.0-companion.1`
> 日期：2026-11-26

## 新增

- Sandboxes 创建时可选择 Agent recipe：
  - OpenCode `opencode-ai@1.19.6`
  - dsh `@deepseek-ai/dsh@0.2.2-rc.5`
  - Hermes Agent `hermes-agent@0.23.4`
  - Pi coding agent `@mariozechner/pi-coding-agent@0.73.1`
- Recipe 创建命令会：
  1. 把 agent 安装到 `/home/agent/.local`；
  2. 验证 binary 存在；
  3. `exec sleep infinity` 保持 sandbox 运行。
- Sandbox 卡片新增：
  - 安装 Agent；
  - 仅验证；
  - 执行命令；
  - 复制 `docker exec -it she-<sandbox> sh` 命令。
- 执行结果显示退出码、stdout、stderr、超时和截断状态。
- 新增 `/api/sandbox/agent-recipes`。
- 默认 Core manifest 更新到 `v0.3.0-core.1`。

## 限制

- 安装发生在容器启动/首次安装时，依赖 npm registry 与网络；hermes 可能下载受管 Python runtime。
- 生产环境仍推荐预构建 agent 镜像并锁定 digest。
- 执行命令是一次性 `docker exec`，不是完整交互式 PTY。
- 当前 sandbox 中的 agent 还没有接入 SHE worker 多 agent 路由。

## 验证

```text
pnpm typecheck  ✓
pnpm test       ✓
pnpm pwa:build  ✓
pnpm build:core ✓
pnpm build:companion ✓
```
