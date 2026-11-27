# 任务单：Sandbox 挂载修复、Workspace 边界确认与 feishu4dsh 复用方案

> 日期：2026-11-27
> 状态：执行中
> 范围：SHE 仓库；feishu4dsh 侧只输出接口方案，不在本仓库直接实现其插件。

## 1. 背景

用户在另一台电脑上用 rootless Docker 创建 sandbox 时失败，broker 返回：

```text
invalid argument "type=bind,src=...,dst=/workspace,rw" for "--mount" flag:
invalid field 'rw' must be a key=value pair
```

同一错误已在本机用 Docker CLI 复现。原因不是 rootless Docker 不可用，而是 SHE 生成的
`docker run --mount` 参数把读写模式写成了裸 `rw`。Docker 的 `--mount` 语法要求：

```text
只读：type=bind,src=...,dst=...,readonly
读写：type=bind,src=...,dst=...        # 省略 readonly 即可
```

裸 `rw` 不是合法的 `--mount` 字段。相同问题存在于 workspace、inbox、outbox、
home、cache 和额外 host mount 的参数生成路径。

## 2. 本轮任务

### T1. 修复 Docker bind mount 参数

- [x] 抽出可测试的 `docker run` argv 构造函数；
- [x] 读写 bind mount 不再生成 `,rw`；
- [x] 只读 bind mount 使用 Docker 接受的 `,readonly`；
- [x] 覆盖 workspace、inbox、outbox、home、cache、extraMounts 的回归测试；
- [x] 用本机 rootless Docker 创建真实容器，验证挂载和读写权限；
- [x] 更新 Sandbox 文档中的挂载说明；
- [x] Sandboxes 创建表单支持选择已授权 workspace；
- [x] sandbox 本地临时目录改名为 `scratch/`。

验收命令：

```sh
pnpm typecheck
pnpm test
pnpm build:core
```

### T2. 明确 Sandbox 与 Workspace 的边界

结论口径：

```text
Sandbox = 一次性/可重建的执行环境与运行时存储
Workspace = agent 长期负责、由用户授权并挂载的项目目录
```

- `sandbox` 数据目录只用于 runtime 状态：home、cache、inbox、outbox、logs、descriptor；
- 默认 `/workspace` 只是 sandbox 内的临时 scratch，不应被视为用户项目；
- 需要长期项目时，必须通过 Workspace 授权目录显式挂载到 `/workspace`；
- worker 可以只用 `/inbox`、`/outbox` 完成任务，不必拥有长期 workspace；
- main/长期 worktree agent 推荐绑定一个明确的 workspace；
- sandbox 的 stop/restart/destroy 与外部 workspace 生命周期分离。

本轮文档和 UI 说明必须写清以上语义；创建时显式选择已授权 workspace 的完整 UI
可作为后续任务，但不能把 sandbox 数据目录误称为项目 workspace。

### T3. feishu4dsh 复用路线

本仓库不继续扩展“第二套飞书实现”的长期目标。方案见
[feishu4dsh 复用与分工建议](20261127-feishu4dsh-reuse-proposal.md)。

本轮只确认：

- feishu4dsh 当前主分支没有飞书 App 扫码创建 onboarding；
- feishu4dsh 的 channel/cards/files 是可复用边界，但不是 SHE 可以直接 import 的插件；
- SHE 内置 gateway 是短期 fallback，不是 feishu4dsh 的长期替代；
- 推荐由 feishu4dsh 提供 `gateway.v1` channel adapter，SHE 只提供 protocol/client；
- 扫码建应用属于 feishu4dsh 或独立 onboarding 工具的工作，延后。

## 3. 非目标

- 不在本轮实现飞书扫码 onboarding；
- 不在本轮实现 sandbox agent 接入 Chat 路由；
- 不自动拉取 Docker 镜像，也不执行 sudo；
- 不改变 broker 是唯一 Docker socket 持有者的事实。

## 4. 验收标准

- [x] 本机 rootless Docker 能按 broker 生成的完整参数创建容器；
- [x] 容器内 `/workspace`、`/inbox`、`/outbox`、`/home/agent`、`/cache` 挂载符合预期；
- [x] `/inbox` 只读，其他指定目录可写；
- [x] 回归测试覆盖不再出现裸 `,rw`；
- [x] Workspace/Sandbox 文档没有“sandbox 数据目录就是项目 workspace”的误导；
- [x] feishu4dsh 分工方案有明确接口、责任边界和待办清单。
