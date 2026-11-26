# ADR-0003：页面请求、supervisor 执行的 companion 更新

> 日期：2026-11-26
> 状态：已采纳
> 关联：ADR-0001、companion 0.3.0

## 背景

ADR-0001 最初规定“PWA 不替换运行中的 companion”。这个边界避免了 PWA 直接杀进程或覆盖文件，但用户体验上无法在页面内完成 companion 重启/更新，也导致用户在 Pages 与本地 127.0.0.1 版本之间产生困惑。

## 决策

引入稳定 supervisor：

```text
start.sh / start.command / start.bat
        │
        ▼
she-companion supervisor（稳定进程）
        │ spawn
        ▼
companion server（可重启）
        │
        ▼
PWA / companion-api.v1
```

页面可以：

- 发现当前 companion 版本；
- 请求重启；
- 请求停止；
- 检查更新；
- 请求安装更新并重启。

但页面仍然：

- 不直接 kill 进程；
- 不直接覆盖文件；
- 不执行任意命令；
- 不绕过 checksum 校验。

## 重启协议

- companion 在 supervisor 下运行时设置 `SHE_COMPANION_SUPERVISED=1`；
- 页面 `POST /api/companion/restart`；
- companion 响应后以约定退出码 `75` 退出；
- supervisor 重新启动 `current/apps/companion/server.mjs`。

## 更新协议

```text
PWA 请求检查更新
  → companion 校验 manifest URL 必须是 SHE GitHub Release
  → 下载 bundle
  → SHA-256 校验
  → 调用 install-companion.sh 安装到新版本目录
  → 写 update-pending.json（previousTarget/newVersion）
  → 旧 companion 退出 75
  → supervisor 启动新 current
  → 新进程 20 秒内退出：切回 previous 并重启旧版本
  → 新进程存活：清理 pending
```

## 安全边界

- manifest URL 只允许 `https://github.com/pancong0711/she/releases/download/...` 或测试用 `file://`；
- 只接受 `schema=1`、`name=she-companion`、合法版本和 SHA-256 的 manifest；
- 页面写操作继续要求 `X-SHE-Local-Action: 1`；
- 页面更新只在 supervisor 模式可用；
- Windows 页面内更新暂不支持，仍使用 start.ps1；
- 不执行 sudo、不请求 root；
- 安装失败时旧 companion 继续运行。

## 结果

- 页面显示 companion 版本、supervisor 状态和 install root；
- 页面可重启 companion；
- 页面可检查并安装新版 companion（Linux/macOS）；
- 更新失败时 supervisor 回滚到 previous；
- 旧版本目录保留，便于人工回滚。
