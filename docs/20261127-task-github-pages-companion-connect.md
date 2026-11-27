# 任务单：GitHub Pages 跨源连接本地 Companion

> 日期：2026-11-27
> 状态：执行中

## 问题

从 `https://pancong0711.github.io/she/` 打开静态 PWA 时，companion、broker、
control plane 全部显示 offline；本地同源页面 `http://127.0.0.1:8787` 正常。

## 根因

跨源 GET 请求携带了非 CORS-safelisted 请求头：

```text
cache-control: no-cache
```

因此浏览器会先发送 OPTIONS 预检。companion 的响应虽然返回了
`access-control-allow-origin`，但 `access-control-allow-headers` 只包含：

```text
authorization, content-type, accept, x-she-local-action
```

缺少 `cache-control`，预检失败。所有使用 `getJson()` 的请求都会失败，正好覆盖：

- `/api/health`；
- `/v1/health`、`/v1/snapshot`；
- `/broker/v1/*`。

## 修复

- [x] 去掉 GET 请求中不必要的 `cache-control` 请求头，继续使用 `cache: 'no-store'`；
- [x] companion CORS 允许列表加入 `cache-control` 等必要头，保持兼容；
- [x] 保留 Private Network Access 支持：
  - `Access-Control-Allow-Private-Network: true`；
- [x] 提取可测试的 CORS helper；
- [x] GitHub Pages 页面在全局显示连接失败原因、目标 URL 和重试/恢复默认地址按钮；
- [x] 增加本地网络访问权限提示；
- [x] 增加回归测试；
- [x] 更新发布与文档。

## 验收

- [x] GET `/api/health` 带 `Origin: https://pancong0711.github.io` 正常返回 CORS 头；
- [x] OPTIONS 预检请求 `access-control-request-headers: accept,cache-control` 允许；
- [x] GET `/v1/health`、`/broker/v1/health` 的代理响应包含 CORS 头；
- [x] 本地页面行为不变；
- [ ] `pnpm typecheck` / `pnpm test` / PWA build / CI 通过。
