# ADR-0002：SHE 不请求、不执行 root 权限

> 日期：2026-11-25
> 状态：已采纳
> 关联：
> - `SECURITY.md`
> - `docs/ENVIRONMENT-BOOTSTRAP.md`
> - `docs/ADR-0001-companion-core-split.md`
> - `docs/SANDBOX-BROKER.md`

## 1. 决策

SHE 的正式运行模型是**当前普通用户下的 local-first 控制面**。

SHE 自己：

- 不以 root 运行；
- 不调用 `sudo` / `su` / `pkexec`；
- 不向用户弹 root 授权请求；
- 不尝试替用户安装需要管理员权限的系统组件；
- 不把 root 密码、sudo token 或提权凭据纳入配置。

如果某个环境组件需要 root 才能安装或配置，SHE 只负责：

1. 检测；
2. 解释缺什么；
3. 展示官方安装/配置方法；
4. 用户在 PWA 外自行执行；
5. 用户回来重新检查。

## 2. 运行账户

推荐：

```text
普通桌面用户 / 普通服务账户
  ├─ she-companion
  ├─ she-control-plane
  ├─ she-broker
  ├─ agent adapter
  └─ sandbox 数据目录
```

所有 sandbox 数据放在当前用户可管理的目录下：

```text
$XDG_DATA_HOME/she/sandboxes/
  <sandbox-name>/
    workspace/
    inbox/
    outbox/
    home/
    cache/
    logs/
```

不默认写 `/srv`、`/var/lib`、`/root` 或系统级共享目录。

## 3. Sandbox runtime

### 3.1 首选：当前用户可用的 Docker context

如果当前用户已经能运行：

```sh
docker info
```

则可以使用该 Docker runtime。

SHE 不负责安装 Docker，也不负责把用户加入 `docker` 组。

注意：

- `docker` 组在很多发行版上是 root-equivalent；
- 这种模式可以获得容器隔离，但不应把它描述成强 rootless 安全边界；
- preflight 会显示 warning：`Docker accessible but not rootless; access may be root-equivalent`。

### 3.2 次选：已由用户/管理员配置好的 rootless Docker

如果用户已经自行配置好 rootless Docker，SHE 可以直接使用。

SHE：

- 不执行 rootless Docker 初始化；
- 不修改 subuid/subgid；
- 不启用 linger；
- 不安装 uidmap/newuidmap；
- 不执行 `dockerd-rootless-setuptool.sh`。

这些操作通常需要 root 或管理员参与，必须由用户明确完成。

### 3.3 Docker 不可用

如果当前用户没有可用的 Docker/Podman runtime：

- sandbox 功能显示 unavailable；
- control plane/agent/PWA 仍可运行；
- PWA 展示运行时安装/配置说明；
- 不在后台尝试提权。

### 3.4 macOS / Windows

- 使用用户已经安装并授权的 Docker Desktop/WSL2/Colima/OrbStack；
- SHE 不调用系统安装器；
- 不请求管理员权限；
- 路径、named pipe、VM 差异由平台 provider 吸收。

## 4. Preflight 变更

`doctor` / install preflight 增加：

```text
user:
  uid=0                → fail（SHE 不能以 root 运行）
  uid!=0               → ok
Docker runtime:
  rootless detected    → ok
  accessible but root  → warn（root-equivalent）
  unavailable          → warn
```

`install` job 仍受 preflight 硬门禁控制。

## 5. 需要 root 的操作如何呈现

只展示方法，不执行。

示例：

```text
检测到 Docker 未安装。
SHE 不会运行 sudo，也不会替你安装系统软件。
请根据你的操作系统官方文档安装：
  - Ubuntu/Debian: ...
  - macOS: Docker Desktop / Colima / OrbStack
  - Windows: Docker Desktop + WSL2
安装完成后回到 Install & Doctor，点击“环境检查”。
```

实际命令文案应带平台判断、版本要求和安全检查；不通过 API 执行。

## 6. 允许自动执行的用户级操作

不需要 root 的操作可以继续由 companion job 执行：

- `pnpm install --frozen-lockfile`；
- 构建；
- 测试；
- 下载并校验用户级 release bundle；
- 写入 `$XDG_DATA_HOME/she`；
- 启动/停止当前用户的 core/companion 进程；
- 当前用户 Docker context 的 sandbox 生命周期。

这些操作仍需显式用户确认和实时日志。

## 7. 验收

- [x] companion 不包含 sudo/pkexec 调用；
- [x] preflight 检查 uid；
- [x] preflight 检查 Docker runtime 是否 rootless；
- [x] PWA 展示 no-root 策略；
- [x] 文档明确 rootless 初始化不由 SHE 执行；
- [ ] 所有平台 bootstrap 文案与支持矩阵；
- [ ] signed installer 明确不请求管理员权限；
- [ ] 系统安装审计与回滚。

## 8. 一句话

> SHE 只使用用户已经拥有的权限；缺少 root 级环境时，给方法，不给提权。
