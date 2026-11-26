# SHE companion 0.2.0 发布说明

> Release：`v0.2.0-companion.2`
> 日期：2026-11-26
> 状态：已发布（compatibility release .2）

## 1. 为什么升级 companion 版本

此前 companion 的代码在持续更新，但 bundle 版本一直是 `0.1.0`，导致：

- 新下载的 `start.sh` 仍指向旧 Release tag；
- launcher 只比较 `VERSION` 文件，看到 `0.1.0 == 0.1.0` 就跳过更新；
- 页面已经更新，但本机 companion API 仍是旧的，于是出现“companion 版本过低”的割裂感。

从 0.2.0 开始，companion 版本与 core/root `package.json` 解耦：

- `apps/companion/package.json` 决定 companion bundle 版本；
- `scripts/build-companion-bundle.sh` 使用 companion 版本；
- `companion-release-manifest.json` 使用 companion 版本；
- launcher 比较真实的 companion 版本，而不是固定的根项目版本。

## 2. Release 资产

```text
companion-release-manifest.json
she-companion-0.2.0.tar.gz
install-companion.sh
install-companion.ps1
```

下载地址：

```text
https://github.com/pancong0711/she/releases/tag/v0.2.0-companion.2
```

## 3. 包含内容

- PWA host、companion-api v1；
- core supervisor、安装/更新/回滚；
- Packages 依赖目录与安装方法；
- preflight 能力/remediation 信息；
- Agent Migration；
- Workspaces 授权注册表；
- Agents 只读健康页面；
- platform 能力矩阵；
- service worker 对导航和 launcher 使用 network-first，避免缓存旧 start.sh；
- Windows/macOS launchers（仍未真机验收）。

## 4. 安装/升级

Linux/macOS 推荐重新下载并运行：

```text
start.sh
```

macOS 也可使用：

```text
start.command
```

Windows 使用：

```text
start.bat
```

launcher 会：

1. 读取新 manifest；
2. 确认当前版本不是 0.2.0；
3. 下载并校验 SHA-256；
4. 安装到独立版本目录；
5. 启动新 companion。

如果检测到旧 companion 仍在运行，launcher 会明确提示先停止旧进程，而不是让新进程以 EADDRINUSE 静默失败。

同时修复了 launcher 用 `-x` 检查 `server.mjs` 导致每次都重新下载 bundle 的问题；现在按 `VERSION` 文件比较版本，执行入口仍使用 `node server.mjs`。

不会执行 sudo，不会请求 root。

## 5. 手动安装

```bash
bash install-companion.sh she-companion-0.2.0.tar.gz \
  --sha256 <manifest.bundle.sha256>
```

或：

```bash
SHE_COMPANION_RELEASE_TAG=v0.2.0-companion.2 bash start.sh
```

## 6. 校验

发布前必须验证：

- bundle SHA-256 与 manifest 一致；
- bundle 内 `VERSION` 为 `0.2.0`；
- bundle 包含 `apps/companion/workspaces.mjs`、`local-agents.mjs`、`preflight.mjs`；
- 新 companion `/api/version` 返回 `0.2.0`；
- `/api/workspaces`、`/api/platform`、`/api/packages` 可用；
- Pages 的 start.sh 下载新 tag；
- 旧 0.1.0 安装可通过 launcher 升级到 0.2.0。

## 7. 为什么有 companion.2

首次发布 `.1` 后，GitHub Release 的 `companion-release-manifest.json` URL 出现 CDN 缓存与更新后的 bundle 不一致，launcher 校验 SHA-256 时发现 manifest 仍是旧 hash。

Release 资产 URL 应视为不可变：修复方式不是覆盖同一 tag，而是发布新的 `v0.2.0-companion.2`，launcher 默认 tag 同步更新。
