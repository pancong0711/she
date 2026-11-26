# SHE companion 0.4.9 发布说明

> Release：`v0.4.9-companion.1`
> 日期：2026-11-26

## 修复与新增

- OpenCode 服务自动发现：
  - 读取 `~/.local/state/opencode/service.json`（OpenCode `serve --service` 写出的当前 URL/密码状态）；
  - 兼容旧的 `~/.config/opencode/service.json`；
  - 检测并验证 `GET /api/info`，只显示路径和 health，不回传密码；
  - 旧默认配置 `http://127.0.0.1:49375 + ~/.config/opencode/service.json`
    会自动跟随检测到的 live service URL；
  - Settings 新增“检测到的本机 OpenCode 服务”和“使用检测到的服务”按钮。
- Core 启动/重启结果改进：
  - PWA 不再无条件显示“已发送重启请求”；
  - 检查 control-plane 和 broker health，失败时显示具体不可达项和 core last error；
  - 后端结果未就绪时额外轮询等待，减少必须手动停止再启动的情况。
- Worker 诊断改进：
  - Chat 失败显示 taskId 和具体错误，并引导到 Agents 页面；
  - Tasks 页面显示 task.error；
  - Settings/Agents 明确 `idle` 只表示当前没有任务在跑。
- 默认 Core manifest 更新到 `v0.2.3-core.1`，包含 worker running 状态修复。

## 重要提示

- 需要同时安装 Core 0.2.3，worker 执行中的 `running` 状态修复才会生效。
- OpenCode `--service` 重启后密码会变化，因此凭据文件应指向
  `~/.local/state/opencode/service.json`，不要复制到旧文件。
- Companion 不读取或显示密码内容。

## 验证

```text
pnpm typecheck  ✓
pnpm test       ✓
pnpm pwa:build  ✓
pnpm build:core ✓
pnpm build:companion ✓
```
