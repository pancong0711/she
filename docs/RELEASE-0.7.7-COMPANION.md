# SHE companion 0.7.7 发布说明

> Release：`v0.7.7-companion.1`
> 日期：2026-11-27

## 修复

### 1. Companion 独立更新通道

`start.sh` / `start.ps1` 不再使用仓库级：

```text
https://github.com/pancong0711/she/releases/latest/download
```

因为该 “Latest” 会被 core/public-packages Release 抢占。现在统一使用：

```text
https://pancong0711.github.io/she/companion-release-manifest.json
```

manifest 内包含绝对 `bundle.url` 与 `launcher.url`，指向具体 companion release。
因此 core/packages 发布不会再影响 companion 安装和升级。

### 2. 修复 launcher 拒绝 Pages channel manifest

0.7.6 的 launcher 仍保留旧校验，只允许 `github.com/.../releases/download/...`，
导致从 Pages channel manifest 启动时报：

```text
companion manifest URL must be an https://github.com release URL
```

0.7.7 允许稳定 channel：

```text
https://pancong0711.github.io/she/companion-release-manifest.json
```

同时继续只允许：

- 上述 Pages channel manifest；
- SHE GitHub Release 下载 URL；
- 测试用 `file://`。

### 3. start 脚本

- `start.sh` / `start.ps1` 无固定 companion 版本号、无固定 tag；
- launcher 下载 URL 来自 channel manifest；
- companion bundle URL 来自 manifest 绝对地址；
- PWA 更新检查同样使用 Pages channel manifest。

## 验证

```text
pnpm typecheck     ✓
pnpm test          ✓
pnpm pwa:build     ✓
pnpm build:core    ✓
pnpm build:companion ✓
```

本机全新安装模拟将通过 channel manifest 安装 0.7.7。

## 升级

- 当前 0.7.2/0.7.5/0.7.6 用户运行一次最新 `start.sh` / `start.ps1`；
- 之后在 Settings 中检查更新即可，不需要再重新下载启动脚本。
