# SHE companion 0.7.4 发布说明

> Release：`v0.7.4-companion.1`
> 日期：2026-11-27

## 修复：GitHub Pages 跨源访问全部 offline

根因是 GitHub Pages（HTTPS）跨源访问本地 companion 时，读请求携带了：

```text
cache-control: no-cache
```

`cache-control` 不是 CORS-safelisted 请求头，会触发 OPTIONS 预检。但 companion
`Access-Control-Allow-Headers` 没有列它，导致浏览器拒绝所有请求：

- `/api/health`；
- `/v1/health`、`/v1/snapshot`；
- `/broker/v1/*`。

因此表现为 companion、broker、control 同时 offline，而本地同源页面正常。

### 修复内容

- 移除跨源读请求中不必要的 `cache-control` 请求头，继续使用 fetch `cache: 'no-store'`；
- companion CORS allowlist 补充：
  - `cache-control`；
  - `pragma`；
  - 保留 `authorization`、`content-type`、`accept`、`x-she-local-action`；
- 暴露 `content-length`、`content-disposition` 响应头，改善 artifact 下载兼容性；
- 保留并验证 Private Network Access：
  ```text
  Access-Control-Allow-Private-Network: true
  ```
- control/broker 代理失败时的 503 响应也带 CORS 头，浏览器能看到真实错误而不是伪装成网络失败；
- 抽出可测试的 `cors.mjs`；
- PWA 增加全局连接诊断：
  - 显示目标 companion URL；
  - 显示真实连接错误；
  - 提供“重试连接”和“恢复默认 127.0.0.1:8787”；
  - 提示浏览器本地网络访问权限；
  - 提供本地同源页面入口。

## 验证

```text
pnpm typecheck                 ✓
pnpm test                      ✓ 110/110
pnpm pwa:build                 ✓
pnpm build:core                ✓
pnpm build:companion           ✓
pnpm build:feishu-gateway      ✓
```

本机 CORS 验证：

```text
OPTIONS /api/health
Origin: https://pancong0711.github.io
Access-Control-Request-Headers: accept,cache-control
Access-Control-Request-Private-Network: true
```

返回：

```text
204 No Content
access-control-allow-origin: https://pancong0711.github.io
access-control-allow-headers: ... accept, cache-control ...
access-control-allow-private-network: true
```

control plane 离线时 `/v1/health` 返回 503，但也包含 CORS 头，页面可显示真实错误。

## 升级

已在 0.7.3 的用户可直接在本地页面：

```text
Settings → 检查 companion 更新 → 安装 0.7.4 并重启
```

升级后回到 GitHub Pages，允许浏览器的本地网络访问权限，再点击“重试连接”。
GitHub Pages 与本地页面不共享 localStorage，但连接同一个 companion API 后会显示同一份
companion/broker/control 数据。
