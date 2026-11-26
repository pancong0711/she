# SHE companion 0.3.0 发布说明

> Release：`v0.3.0-companion.1`
> 日期：2026-11-26

## 1. 新增

- companion supervisor；
- PWA 页面内显示 companion 当前版本；
- 页面内重启 companion；
- 页面内停止 companion；
- 页面内检查 companion 更新；
- 页面内安装更新并重启；
- update manifest URL 白名单（仅 SHE GitHub Release）；
- bundle SHA-256 校验；
- 20 秒启动窗口失败自动回滚 previous；
- 非 supervisor 模式自动禁用上述操作并说明原因。

## 2. 进程模型

```text
start.sh / start.command / start.bat
  → supervisor.mjs
    → companion server.mjs
```

页面请求重启时，companion 以退出码 `75` 退出，supervisor 重新启动 `current`。

页面请求更新时：

```text
check manifest
→ download bundle
→ verify SHA-256
→ install new version
→ write update-pending.json
→ exit 75
→ supervisor starts new version
→ startup < 20s fails -> rollback previous
→ startup succeeds -> clear pending
```

## 3. 边界

- PWA 不直接 kill 进程；
- PWA 不直接覆盖文件；
- 不执行任意命令；
- 不执行 sudo/不请求 root；
- Windows 页面内更新暂不支持，使用 start.ps1；
- dev 模式 `pnpm companion` 不是 supervisor，页面内生命周期操作会禁用。

## 4. 验证

- supervisor restart/shutdown smoke；
- 0.3.0 → 0.3.1 页面 API 更新成功；
- 故意让新版本启动退出，supervisor 回滚到 0.3.0；
- update-pending.rolled-back.json 保留；
- manifest URL 白名单测试；
- version compare / manifest validation 单测。
