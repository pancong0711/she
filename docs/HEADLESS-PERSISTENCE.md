# 无登录/远程部署的后台常驻与环境检查

> 状态：v1
> 关联：rootless Docker、companion autostart、linger、OpenCode、feishu4dsh

## 1. 结论

`systemctl` 不等于“退出登录后一定继续运行”。

Linux 上有两类：

- system service：由 PID 1 管理，通常随开机运行；
- user service：由 `systemd --user` 管理，通常随用户会话运行。

rootless Docker、SHE companion 等用户级进程属于第二类。

用户级服务默认可能在最后一个登录会话结束后停止。要让它持续运行：

```text
systemctl --user enable --now <service>
+ loginctl enable-linger "$USER"
```

## 2. 为什么需要 linger

`enable-linger`：

- 让 `user@<uid>.service` 在用户没有登录会话时继续运行；
- 让 user manager 随系统启动；
- 不把服务变成 root 服务；
- 不会把 SSH shell 里手工启动的进程自动变成服务。

需要配合 user service：

```bash
systemctl --user enable --now docker
```

检查：

```bash
loginctl show-user "$USER" -p Linger
# Linger=yes
systemctl --user is-enabled docker
systemctl --user is-active docker
```

## 3. 哪些服务需要考虑

| 服务 | 当前形态 | 是否需要额外常驻 |
|---|---|---|
| Companion | 用户进程 / 可由 SHE autostart 生成 systemd --user service | 建议 user service + linger |
| Core control-plane/broker | 由 companion 启动的子进程 | 跟随 companion；不需要单独 service |
| rootless Docker | 用户 systemd service | `enable --now docker` + linger |
| OpenCode server | 外部进程，SHE 只连接 | 需要用户自行配置 service；否则 Chat 不可用 |
| feishu4dsh gateway | 外部进程，SHE 只接收 gateway.v1 | 需要用户自行配置 service；否则飞书连接中断 |
| 本地 Ollama/vLLM 等模型服务 | 外部进程 | 如使用则需要相同常驻策略 |
| PWA | 浏览器应用 | 不需要后台 service |

## 4. 环境检查新增项

Install & Doctor 现在会检查：

- `systemd --user` 是否可用；
- `Linger` 是否为 yes；
- Companion 登录自启动是否已启用；
- rootless Docker 是否可用；
- OpenCode `/api/info` health；
- 已配置的 feishu4dsh health；
- control/broker socket。

环境摘要新增：

```text
headless persistence: ready / needs attention
```

未就绪时会显示：

- 用户 systemd 不可用；
- linger 未开启；
- companion 自启动未启用；
- 以及对应修复命令。

## 5. 远程部署推荐组合

```text
systemctl --user enable --now docker
sudo loginctl enable-linger "$USER"

SHE Settings → 登录自启动 → enable
Feishu adapter → 配置成同一用户的 systemd --user service
OpenCode → 配置成用户级 service 或远程独立服务
```

## 6. 安全边界

- linger 需要管理员/polkit 权限；
- linger 不会让 rootless Docker 变成 root；
- docker 组仍是 root-equivalent 风险；
- SHE 不自动执行 `loginctl enable-linger`；
- 不创建系统级 root service；
- 所有服务仍以当前普通用户运行。
