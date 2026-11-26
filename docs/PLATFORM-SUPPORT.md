# 平台能力与支持矩阵

> 状态：T6.8 部分完成（平台探测 + 支持矩阵页面）
> 代码：
> - `apps/companion/server.mjs` → `platformStatus()`
> - `apps/pwa/src/App.vue` → Install & Doctor 平台能力卡片
> - `docs/PLATFORM-SUPPORT.md`

## 1. 目标

SHE 跨平台时不能把“代码存在”当成“已经验证”。平台页面明确区分：

- 已验证；
- 已实现但未真机验收；
- 仅设计；
- 不支持。

同时显示当前机器的：

- OS / arch / Node 版本；
- shell；
- uid；
- WSL 状态；
- Docker 是否可用；
- Docker 是 rootless 还是可能 root-equivalent；
- Unix socket 是否可用。

## 2. API

```text
GET /api/platform
```

返回示例：

```json
{
  "schema": 1,
  "runtime": {
    "platform": "linux",
    "arch": "x64",
    "node": "24.x",
    "shell": "bash",
    "wsl": false
  },
  "docker": {
    "available": true,
    "mode": "rootless",
    "version": "27.0"
  },
  "capabilities": {
    "pwa": true,
    "companion": true,
    "coreSupervisor": true,
    "unixSocket": true,
    "sandboxBroker": true,
    "agentMigration": true,
    "rootlessDocker": true
  },
  "supportMatrix": [
    {
      "feature": "Sandbox broker / Docker",
      "linux": "verified",
      "macos": "implemented-unverified",
      "windows": "design-only"
    }
  ],
  "notes": [
    "SHE never executes sudo and never requests root."
  ]
}
```

## 3. 当前矩阵

| 能力 | Linux | macOS | Windows |
|---|---|---|---|
| PWA / Companion | verified | implemented-unverified | implemented-unverified |
| Core install / update / rollback | verified | implemented-unverified | implemented-unverified |
| OpenCode worker / Chat | verified | implemented-unverified | implemented-unverified |
| Sandbox broker / Docker | verified | implemented-unverified | design-only |
| Agent Migration host mounts | implemented-unverified | design-only | design-only |
| Unix-socket control plane | verified | implemented-unverified | unsupported |

- `verified`：已有实际运行/测试证据；
- `implemented-unverified`：代码路径已存在，但未做目标平台真机验收；
- `design-only`：只有设计，不应宣称可用；
- `unsupported`：当前实现明确不支持。

## 4. 平台限制

### Linux

- 当前主验证平台；
- Unix socket、core bundle、Docker/rootless 路径已验证；
- 推荐 rootless Docker；Docker 组权限仍提示 root-equivalent 风险。

### macOS

- companion launcher、core bundle、PWA 已实现但未真机验收；
- Docker Desktop / OrbStack / Colima 的路径与权限需要真实环境验证；
- 不支持 sudo 自动安装。

### Windows

- Windows launcher/PowerShell 脚本已存在但未真机验收；
- Unix-socket control plane 当前不支持原生 Windows；
- Docker Desktop/WSL2 配置由用户本人完成；
- path/UID/GID、named pipe、服务生命周期仍需单独适配。

## 5. 安全说明

- 平台探测只读取运行时信息、Docker 版本与安全选项；
- 不读取凭据内容；
- 不执行 sudo；
- 不自动修改系统服务；
- 不把 Docker 组权限宣称为 rootless；
- 未验证平台不能显示为 production-ready。

## 6. 后续

- T3.6：Linux/rootless 能力探测与支持负例测试；
- T3.7：macOS/Windows provider 设计（named pipe/WSL2/Docker Desktop）；
- 平台安装向导需要显式用户确认、checksum、审计和回滚。
