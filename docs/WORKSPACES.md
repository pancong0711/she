# Workspace 授权与叶子目录策略

> 状态：T6.5 首版（授权注册表 + PWA 页面）；broker 实际挂载强制执行仍待接入迁移 UI
> 代码：
> - `apps/companion/workspaces.mjs`
> - `apps/companion/server.mjs`
> - `apps/pwa/src/components/WorkspaceAuthorizationPanel.vue`
> - `docs/WORKSPACES.md`

## 1. 目标

Workspace 授权页用于显式登记用户允许 agent 访问的目录，并记录权限意图：

```text
read-only
read-write
```

原则：

- 只接受明确的叶子目录；
- 拒绝文件系统根目录；
- 拒绝用户 home 本身；
- 拒绝受保护系统路径；
- 不读取目录内容；
- 不执行 sudo；
- 授权记录只保存路径、标签和权限意图。

## 2. 授权注册表

默认路径：

```text
$XDG_CONFIG_HOME/she/workspaces.json
回退 ~/.config/she/workspaces.json
```

可覆盖：

```text
SHE_WORKSPACE_REGISTRY
```

权限：目录 0700，文件 0600。

记录示例：

```json
{
  "id": "ws-a6b3dc357be0",
  "label": "demo project",
  "path": "/home/user/projects/demo",
  "realPath": "/home/user/projects/demo",
  "mode": "read-write",
  "authorizedAt": 1760000000000
}
```

ID 由 realpath 的 SHA-256 前缀生成，同一真实目录重复授权会更新记录。

## 3. 路径规则

允许：绝对路径、存在、目录、当前用户可读；read-write 模式必须可写。

拒绝：

- `/` 或 Windows drive root；
- 用户 home 本身；
- `/home`、`/Users`、`/mnt`、`/media`、`/Volumes`、`/tmp` 等范围过大的容器目录本身；
- `/etc`、`/usr`、`/bin`、`/sbin`、`/lib`、`/boot`、`/dev`、`/proc`、`/sys`、`/run` 等受保护系统路径；
- 不存在的路径、非目录；
- read-write 授权但不可写。

symlink 会先 `realpath`，再按真实路径校验和判重。

## 4. Companion API

```text
GET    /api/workspaces
POST   /api/workspaces
DELETE /api/workspaces/:id
```

POST body：

```json
{
  "label": "demo project",
  "path": "/home/user/projects/demo",
  "mode": "read-write"
}
```

写操作要求 `X-SHE-Local-Action: 1`。响应包含 registry 路径、授权列表、exists/isDirectory/readable/writable、leafAuthorized 和 warnings。

## 5. PWA Workspaces 页面

页面支持查看授权、新增、选择 read-only/read-write、删除，并显示 realpath、r/w 权限、叶子目录状态和 warning。

## 6. Workspace 与 Sandbox 的关系

```text
Workspace = 用户授权的项目目录，可被 agent 长期使用
Sandbox    = 可重建的执行环境和运行时存储
```

- 不绑定 workspace 时，容器的 `/workspace` 只是 sandbox 本地 scratch；
- 绑定 read-write 授权目录时，broker 把它挂载为 `/workspace`；
- read-only 授权目录可用于 `/legacy` 只读参考，不作为项目写工作区；
- worker 可以只靠 `/inbox`、`/outbox` 交付，不必拥有 workspace；
- main/长期 worktree agent 推荐绑定明确 workspace；
- 删除 sandbox 不删除外部 workspace。

## 7. 强制边界

本版是授权策略注册表，不直接挂载宿主机目录。真正的目录挂载必须通过 broker 的 `hostMounts` 路径：broker 再次 realpath，拒绝根目录、home 本身、受保护系统路径、非目录，并强制 `/legacy` 和凭据 home 挂载只读。

当前限制：

- worker 的直接 workspace 模式仍由 `SHE_WORKSPACE_PATH` 决定，不读取本注册表的 read-only 策略；
- Agent Migration 已要求来源目录从授权列表选择，并在计划中记录 `workspaceAuthorizationId`；
- read-only 授权可在 Agent Migration 中用于新建 workspace 的 `/legacy` 只读挂载；
- 复用为 `/workspace` 时必须选择 read-write 授权；
- 后续仍需把 worker 直接模式与授权策略统一，才能对 worker 本身强制 read-only。

因此 T6.5 标记为部分完成，不能把本页的 read-only 选择误解为已经对 worker 强制只读。

## 8. 验收

- [x] 叶子目录校验；
- [x] root/home/系统路径拒绝；
- [x] read-only/read-write 权限意图；
- [x] 0600 registry；
- [x] PWA 新增/删除/列表；
- [x] warning 显示；
- [x] broker 侧已有二次校验与只读强制；
- [x] Agent Migration 强制绑定授权 ID；
- [ ] worker/sandbox 统一读取授权策略；
- [ ] macOS/Windows 真机验收。
