# SHE companion 0.7.12（SHE App Shell）发布说明

> Release：`v0.7.12-companion.1`
> 日期：2026-11-27

## 架构变化

- companion 明确为 **SHE App Shell**，launcher 才是稳定低频层；
- 新安装统一使用 `SHE_HOME`：
  - Linux/macOS：`${XDG_DATA_HOME:-~/.local/share}/she`
  - Windows：`%LOCALAPPDATA%\SHE`
- 新布局：
  ```text
  SHE_HOME/
    app/
    core/
    config/
    state/
    run/
    bin/
    workspaces/
  ```
- 旧 `companion`/XDG config/state 布局继续可运行；新增 `/api/home/status` 与
  `/api/home/migrate`，可安全复制旧目录到新布局，不删除旧数据。
- 新增 `pnpm home:migrate` 与 `node scripts/migrate-she-home.mjs [--apply]`。

## 启动入口

- `start.sh` / `.command` / `.ps1` / `.bat` 本地 launcher 优先；
- 只有首次安装或 `SHE_FORCE_LAUNCHER_REFRESH=1` 时才走网络 bootstrap；
- 安装后由 launcher 检查 App 更新、启动 App Shell，并在可用时打开 PWA。

## 职责收敛

- 内置 Feishu gateway 标记为 **legacy**，新部署应使用 feishu4dsh standalone
  gateway 通过 gateway.v1 直连 SHE；
- workspace/broker 挂载的最终安全校验仍由 broker 执行，App Shell 的授权列表
  只作为用户确认与 UI 管理；
- 新增 `GET /api/updates/status`，统一检查 App Shell 与 Core 的 remote manifest；
- PWA Settings 增加 SHE_HOME 状态、旧布局迁移和统一版本检查入口。

## 升级

旧安装仍可运行。建议：

1. 更新到 0.7.12；
2. 在 Settings 中执行“复制旧目录到 SHE_HOME”；
3. 重启 SHE；
4. 验证 App/Core 正常后自行删除旧目录。
