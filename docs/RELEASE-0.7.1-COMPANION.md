# SHE companion 0.7.1 发布说明

> Release：`v0.7.1-companion.1`
> 日期：2026-11-27

## 修复

- OpenCode Agent recipe 的 npm package 从旧包 `opencode-ai` 切换到当前 v2 包：
  ```text
  @opencode/cli
  ```
  OpenCode `2.4.2` 已加入内置推荐版本，并可通过版本校验解析。
- Settings 的 OpenCode 检测新增模型列表：
  - 从运行中的 OpenCode `/api/model` 读取 provider/model；
  - 可一键填入当前 provider/model；
  - 显示是否免费（模型名包含 free）；
  - 重新检测显示明确结果和时间，避免静默无反馈。
- 版本校验和成功安装记录保持：
  - registry 精确版本存在则使用；
  - 不存在则回退最新稳定版并提示；
  - 每个 agent 最近 5 个成功版本。

## OpenCode 升级提示

OpenCode 2.x 服务重启后会重新生成：

```text
~/.local/state/opencode/service.json
```

service.json 中的 `version`/`url`/`password` 才是运行中服务的实际值。
如果刚升级 CLI 但 `openapi service` 仍是旧版本，需要停止旧 service，再运行新版：

```sh
opencode serve --service --hostname 127.0.0.1 --port 49374
```

重启后回到 SHE Settings 点击“重新检测”和“使用检测到的服务”。

## 验证

```text
pnpm typecheck  ✓
pnpm test       ✓ 102/102
pnpm pwa:build  ✓
pnpm build:companion ✓
```
