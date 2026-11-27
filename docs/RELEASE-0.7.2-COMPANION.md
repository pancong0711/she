# SHE companion 0.7.2 发布说明

> Release：`v0.7.2-companion.1`
> 日期：2026-11-27

## 修复

- 修复 Sandbox 创建必然失败的问题：Docker `--mount` 参数不再生成非法的裸 `rw`。
  - 读写挂载省略 `readonly`；
  - 只读挂载使用 Docker 支持的 `readonly`；
  - 覆盖 workspace、inbox、outbox、home、cache 和额外 host mount。
- 将 sandbox 本地临时目录从 `workspace/` 语义拆分为 `scratch/`，明确它不是用户项目 workspace。
- Sandboxes 创建表单新增“项目 Workspace（可选）”：
  - 从 Workspaces 授权列表选择；
  - 选择后由 broker 显式挂载到 `/workspace`；
  - 不选择时 `/workspace` 仅使用 sandbox 本地 scratch。
- 更新 Workspace/Sandbox 关系文档和 PWA Help。

## 根因

Docker 的 `--mount` 不接受裸 `rw` 字段，错误为：

```text
invalid field 'rw' must be a key=value pair
```

SHE 原来的参数生成对每个 bind mount 都追加了 `,rw`，因此无论 rootless Docker
是否正常，创建 sandbox 都会在参数解析阶段失败。

## 验证

```text
pnpm typecheck                 ✓
pnpm test                      ✓ 104/104
pnpm pwa:build                 ✓
pnpm build:core                ✓
pnpm build:companion           ✓
pnpm build:feishu-gateway      ✓
```

本机 rootless Docker 实测：

```text
docker info SecurityOptions: seccomp, rootless, cgroupns
```

使用本地构建的最小镜像完成真实容器验证：

- broker 创建容器成功，状态 running；
- `/workspace` 绑定外部目录后可写，宿主侧能看到容器写入；
- `/legacy` 只读挂载写入被拒绝；
- `/inbox` 只读挂载写入被拒绝；
- `/home/agent`、`/cache`、`/outbox` 可写；
- 不绑定 host workspace 时默认 scratch 可创建并可执行命令。

## 升级后仍可能遇到

如果本机没有目标镜像且 Docker registry 不可达，Docker 会在 pull 阶段失败。此时
需要先手动拉取镜像或配置 registry mirror，例如：

```sh
docker pull node:24-bookworm
```

SHE 不自动执行 sudo，也不会绕过 Docker 的镜像获取策略。
