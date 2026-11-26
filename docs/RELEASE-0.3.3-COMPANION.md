# SHE companion 0.3.3 发布说明

> Release：`v0.3.3-companion.1`
> 日期：2026-11-26

## 新增

- Gateway 页面：
  - control-plane gateway.v1 状态；
  - feishu4dsh loopback health URL 配置；
  - adapter health 探测；
  - 明确飞书 secret 仅在 feishu4dsh。
- `/api/gateway` 配置 API：
  - 只允许 loopback health URL；
  - 不保存 token/secret；
  - 写操作要求本地 action header。

## 审核修复

- supervisor 重启预算在稳定运行 60 秒后重置，避免页面重启 5 次后 supervisor 永久退出；
- Windows `install-companion.ps1` 现在生成 supervisor launcher，并正确使用 `$BinDir`；
- Windows/XDG 自启动命令路径使用引号，避免空格路径失效；
- 安装版 companion 的源码开发 job 继续被隐藏/阻断。

## 更新

- 0.3.x supervisor 用户可在 Settings 中检查并安装 0.3.3；
- 0.2.x 或更早版本需要先运行新版 start.sh 升级一次。

## 验证

- pnpm typecheck；
- pnpm test；
- pnpm pwa:build；
- supervisor restart/shutdown；
- update success / rollback；
- autostart systemd-user smoke；
- no-Docker core smoke；
- gateway loopback URL 与 secret-strip 单测。
