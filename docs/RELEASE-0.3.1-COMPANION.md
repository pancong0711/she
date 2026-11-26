# SHE companion 0.3.1 发布说明

> Release：`v0.3.1-companion.1`
> 日期：2026-11-26

## 新増

- Agent Migration 的复用目录/旧目录挂载必须选择 Workspaces 授权 ID；
- `reuse` 必须选择 read-write 授权；
- `new` + `/legacy` 可以使用 read-only 或 read-write 授权；
- 迁移计划与迁移记录保存 `workspaceAuthorizationId`；
- 旧的任意路径迁移入口关闭，避免绕过授权注册表；
- broker 仍进行 realpath、root/home/系统路径和只读强制校验。

## 安装

从 Pages 重新下载 `start.sh` 后运行，或已有 0.3.0 supervisor 时在 Settings 中检查并安装更新。

## 边界

- worker 直接 workspace 模式仍不读取授权注册表的 read-only 策略；
- Windows 页面内更新暂不支持；
- 旧 companion 0.2.x/0.3.0 首次升级到 0.3.1 仍需一次 launcher 或页面更新；0.3.0 已包含 supervisor，可直接通过页面检查更新。
