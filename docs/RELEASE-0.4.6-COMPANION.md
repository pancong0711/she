# SHE companion 0.4.6 发布说明

> Release：`v0.4.6-companion.1`
> 日期：2026-11-26

## 新增

- Preflight 增加 headless persistence 检查：
  - `systemd --user`；
  - `loginctl` Linger；
  - Companion 登录自启动；
  - rootless Docker；
  - OpenCode health；
  - 已配置 feishu4dsh health。
- 环境摘要新增：
  ```text
  headless persistence: ready / needs attention
  ```
- 未就绪时显示具体修复命令和 Settings/Packages 快捷入口。
- 新增 `docs/HEADLESS-PERSISTENCE.md`，说明：
  - system service vs user service；
  - linger 的真实含义；
  - 为什么 SSH 退出后服务可能停止；
  - companion/core/rootless Docker/OpenCode/feishu4dsh 的常驻矩阵。

## 修正

- Docker rootless 第 16 步更明确说明 `loginctl enable-linger`；
- 环境检查不再把“rootless Docker 可用”错误等同于“无登录时仍常驻可用”。
