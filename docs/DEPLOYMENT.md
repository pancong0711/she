# SHE 部署命名与本地约定

> 日期：2026-11-25
> 状态：跨项目约定 v0.1
> 适用范围：she-control-plane、she-broker、feishu4dsh gateway、PWA、CLI

## 1. 本地服务命名

建议并逐步采用：

| 组件 | systemd user service |
|---|---|
| SHE 控制面 | `she-control-plane.service` |
| sandbox broker | `she-broker.service` |
| 飞书 gateway（由 feishu4dsh 提供） | 保持 feishu4dsh 自己的 unit 名称，后续再评估迁移 |

SHE 不自动启动/修改 feishu4dsh 的 unit，feishu4dsh 也不自动启动 SHE。

## 2. Unix socket 与 token 路径

优先级：

```text
$XDG_RUNTIME_DIR/she/control.sock
  回退：~/.local/run/she/control.sock
```

要求：

- 目录由 SHE 创建，权限 0700；
- socket 0600；
- 不监听 TCP/LAN；
- 路径可由配置文件覆盖，但默认和 doctor 输出必须一致；
- 客户端（`@she/client`）接收显式 socketPath，不自行猜测部署路径。

可选认证 token：

```text
~/.config/she/token
```

- 0600；
- 为空或不存在时允许同用户 peer credential 模式（后续实现）；
- client 通过 `Authorization: Bearer <token>` 发送；
- 不在 PWA 或日志中打印 token。

## 3. 状态与数据目录

建议：

```text
~/.local/state/she/       # SQLite、event spool、运行状态
~/.local/share/she/       # sandbox registry、artifact、审计
~/.config/she/            # 配置、token、模型配置
```

迁移旧 `feishu4dsh` 路径：

- 不静默改旧路径；
- 提供一次性 import/migrate 工具；
- 迁移前备份；
- 失败可回滚；
- 旧路径兼容期写入文档和 `she doctor` 提示。

## 4. 本机 pact

- gateway/PWA 都只能通过公开 API 与 control-plane 通信；
- broker 是唯一 Docker socket 持有者；
- `she-control-plane` 可在没有 Docker/broker 时启动并显示 degraded；
- 服务重启不自动删除 sandbox；
- upgrade/rollback 需要显式操作和日志；
- 状态写入必须只有一个 control-plane 实例（多实例 leader/事务设计后置）。

## 5. 发布矩阵

发布列车：

```text
@she/protocol  0.1.x
@she/client    0.1.x
she           0.1.x
gateway protocol v1
```

feishu4dsh 首期锁：

```json
{ "@she/protocol": "~0.1.0", "@she/client": "~0.1.0" }
```

兼容矩阵模板：

| SHE | @she/protocol | @she/client | gateway protocol | feishu4dsh | 状态 |
|---|---|---|---|---|---|
| 0.1.x | 0.1.x | 0.1.x | v1 | 待接入 | 开发中 |
