# SHE companion 0.7.16（SHE App Shell）发布说明

> Release：`v0.7.16-companion.1`
> 日期：2026-11-27

## 修复

- Agent recipe 安装后的异步验证窗口原先固定为 40 次 × 5 秒（200 秒），
  但 Hermes/dsh 等 recipe 的 bootstrap timeout 可达 300 秒，导致实际安装成功
  后 PWA 已停止验证、也不会记录成功版本。
- 验证轮询现在按 `recipe.bootstrap.timeoutMs + 60s grace` 计算。300 秒 recipe
  最长验证约 360 秒。
- 超时后在 Sandboxes 页面显示明确错误，便于用户到卡片中重新安装或手动验证。
- 保留 0.7.15 的 sandbox 命令解析修复。

## 验证

```text
tsc -b                         ✓
vue-tsc --noEmit               ✓
Vitest                         ✓ 40 files / 136 tests
companion bundle build         ✓
```
