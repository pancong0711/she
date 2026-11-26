# SHE companion 0.2.1 发布说明

> Release：`v0.2.1-companion.1`
> 日期：2026-11-26
> 状态：发布版

## 1. 修复内容

### 本地 PWA 与 Pages 版本割裂

`http://127.0.0.1:8787` 的页面由本机 companion bundle 提供，不会因为 GitHub Pages 更新而自动变化。为减少旧缓存：

- `index.html`、`sw.js`、`manifest.webmanifest`、`start.*` 返回 `cache-control: no-cache`；
- service worker 对页面导航和 launcher 使用 network-first；
- companion 版本升级到 `0.2.1`，launcher 能明确发现需要更新；
- PWA 显示最低 companion 版本提示。

### launcher

- 修复用 `-x` 检查不可执行的 `server.mjs` 导致重复下载 bundle；
- 检测旧 companion 占用端口时明确提示先停止旧进程；
- 检测到同版本已在运行时只打开页面，不再重复启动；
- Release tag 与 companion 版本解耦，并使用新的不可变 release tag。

## 2. 更新方法

1. 停止旧的本地 companion；
2. 从 Pages 重新下载并运行 `start.sh`；
3. 确认：

```bash
curl -s http://127.0.0.1:8787/api/version
```

应返回：

```json
{ "ok": true, "value": { "companion": "0.2.1" } }
```

4. 如果页面仍是旧的，执行一次强制刷新，或在 DevTools → Application → Service Workers 中 unregister 旧 service worker 后重新加载。

## 3. 关键边界

- 本地 companion 页面不会由 GitHub Pages 自动替换；
- 本机 companion 必须升级并重启才能获得新 PWA bundle；
- PWA 不会在运行中替换 companion；
- 不执行 sudo，不请求 root。

## 4. 校验

- bundle manifest 中的 SHA-256 与实际 bundle 一致；
- bundle 内 `VERSION` 为 `0.2.1`；
- `/api/version` 返回 `0.2.1`；
- `/api/platform`、`/api/workspaces`、`/api/packages` 可用；
- Pages 的 `start.sh` 指向 `v0.2.1-companion.1`。
