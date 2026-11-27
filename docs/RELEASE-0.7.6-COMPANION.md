# SHE companion 0.7.6 发布说明

> Release：`v0.7.6-companion.1`
> 日期：2026-11-27

## 修复：新安装仍是 0.7.2 / companion 更新通道失效

### 根因

`start.sh` / `start.ps1` 之前使用 GitHub **仓库级**：

```text
https://github.com/pancong0711/she/releases/latest/download/...
```

仓库同时有 companion、core、public packages 三类 Release。发布
`v0.1.0-packages.2` 后，GitHub 的 `latest` 指向 packages release，导致：

```text
releases/latest/download/companion-release-manifest.json
```

返回 404。已有 0.7.2 launcher 的用户会走本地 fallback，所以一直停留在旧版本。

### 修复

建立 companion 独立发布通道：

```text
https://pancong0711.github.io/she/companion-release-manifest.json
```

manifest 包含绝对地址：

```json
{
  "bundle": { "file": "...", "url": "https://github.com/.../releases/download/<tag>/...", "sha256": "..." },
  "launcher": { "file": "she-launcher.mjs", "url": "https://github.com/.../releases/download/<tag>/she-launcher.mjs", "sha256": "..." }
}
```

- `start.sh` / `start.ps1` 不再使用 `releases/latest`；
- start 脚本从 Pages channel manifest 取 launcher URL；
- launcher 默认从 Pages channel manifest 检查 companion；
- launcher 优先使用 manifest 的绝对 `bundle.url`；
- PWA companion 更新检查也改为 Pages channel manifest；
- companion 构建会生成 `apps/pwa/public/companion-release-manifest.json`；
- CI 测试保证 channel manifest 版本与 companion package 版本一致；
- core/packages Release 不再影响 companion 更新通道。

## 验证

```text
pnpm typecheck                 ✓
pnpm test                      ✓
pnpm pwa:build                 ✓
pnpm build:core                ✓
pnpm build:companion           ✓
pnpm build:feishu-gateway      ✓
```

本机全新安装模拟：

```text
start.sh
  → channel manifest
  → she-launcher.mjs 2
  → companion 0.7.6
  → /api/health version=0.7.6
  → launcherVersion=2
```

## 升级

- 已安装 0.7.3+ 的用户：在 Settings 中检查更新并安装 0.7.6；
- 已在 0.7.2 且启动脚本 fallback 的用户：运行一次最新 `start.sh` / `start.ps1`，
  新 launcher 会从独立 channel manifest 找到 0.7.6；
- 以后 companion 升级继续在页面内完成，不需要重新下载启动脚本。

## 发布规则

- companion Release 才标记为 GitHub `Latest`；
- core / public packages Release 使用 `--latest=false`；
- even if 操作失误，start 脚本和 launcher 也不再依赖仓库级 latest。
