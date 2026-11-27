# Companion 登录自启动

> 状态：v1（Linux systemd --user / XDG autostart、macOS LaunchAgent、Windows Startup）
> 原则：只使用用户级机制，不请求 root。

## 1. 是否每次都要运行 start.sh/bat

首次需要运行一次 `start.sh`/`start.bat` 安装稳定 launcher。之后可通过已安装的 `she-companion` 命令或登录自启动恢复；关闭终端、停止进程或重启系统后默认不会自动恢复。

可以在 Settings → Companion 版本与生命周期 → 登录自启动 中启用用户级自启动。

## 2. 平台实现

### Linux

优先写入：

```text
~/.config/systemd/user/she-companion.service
```

然后执行：

```bash
systemctl --user daemon-reload
systemctl --user enable she-companion.service
```

如果当前会话没有可用的 user systemd manager，会 fallback 到：

```text
~/.config/autostart/she-companion.desktop
```

systemd --user 通常在桌面登录时启动。未登录启动需要 linger，而 linger 配置需要用户本人/管理员完成，SHE 不执行。

### macOS

写入：

```text
~/Library/LaunchAgents/dev.she.companion.plist
```

登录时由 launchd 启动。

### Windows

写入用户 Startup 文件夹：

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\she-companion.cmd
```

## 3. 与页面停止/重启的关系

- 页面“重启 companion”：supervisor 重启当前 companion；
- 页面“停止 companion”：companion 退出 0，自启动不会在当前会话自动拉起；
- 下次登录时，如果自启动开启，会重新启动；
- 禁用自启动不会删除 companion 数据或版本目录。

## 4. 安全边界

- 不创建系统级 service；
- 不请求 root；
- 不写 `/etc`；
- 不执行 sudo；
- 不自动配置 linger；
- 自启动命令只指向已安装的 companion supervisor，不接受任意用户命令。

## 5. 当前限制

- macOS/Windows 自启动尚未真机验收；
- Linux systemd --user 在不同桌面/容器环境可能不可用，已提供 XDG fallback；
- 首次启用前需要 companion 由 start.sh/start.ps1 安装的稳定 launcher 启动；自启动指向 `$INSTALL_ROOT/launcher.mjs`，不指向版本目录。
