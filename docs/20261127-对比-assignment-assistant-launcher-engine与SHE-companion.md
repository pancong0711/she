# 对比：assignment-assistant launcher/engine 与 SHE launcher/companion

> 日期：2026-11-27 ｜ 状态：SHE 已完成对齐改动并本地实测
> 参考：
> - assignment-assistant `docs/22-D71-engine-launcher-two-phase-update.md`
> - assignment-assistant `tools/start.sh` / `tools/start.bat`
> - assignment-assistant `src/assist/engine_update.py`
> - SHE `docs/ADR-0004-stable-companion-launcher.md`

## 1. 两套模型对照

| 维度 | assignment-assistant | SHE（本次修改前） | SHE（本次修改后） |
|---|---|---|---|
| 稳定启动层 | `start.sh` / `start.bat` | `launcher.mjs` + 薄 `start.sh` | 不变 |
| 可更新主体 | Python engine | Companion/PWA | 不变 |
| 启动时检查更新 | 每次启动检查 `engine-version.json` | 仅在 `SHE_LAUNCHER_UPDATE_ON_START=1`（通常只有 start.sh 设置） | **每次 launcher 启动默认检查 manifest** |
| 更新检测下载 | 小版本文件，变化才下载 zip | 小 manifest，变化才下载 bundle | 相同原则 |
| 下载传输 | 系统 curl + 多源重试 | Node fetch（页面更新）/ Node fetch（launcher） | **Node fetch 失败自动回退 curl** |
| 两阶段更新 | staging + pending，launcher 在 engine 停止后安装 | 页面下载、版本目录切换、退出 75、launcher 重启 | 相同原则；停止状态下 launcher 可直接安装 |
| 回滚 | `engine.bak` + pending failed | `versions/*` + `current` + `update-pending.json` | 不变，版本目录更清晰 |
| 完整性 | commit/version + 包校验 | manifest SHA-256 + bundle SHA-256 | 不变 |
| 页面更新入口 | 有，staging + restart | 有，下载 + switch + exit 75 | 不变 |
| 启动脚本重下频率 | launcher 本身基本稳定 | launcher 已稳定，但启动时默认不查更新 | 正常重启 `she-companion` 即可查更新 |

## 2. 结论

assignment-assistant 更方便的核心原因是：

```text
每次启动稳定 launcher
  → curl 检查小版本文件
  → 有差异就下载/安装新 engine
  → supervisor 继续运行
```

而不是依赖页面更新，也不是依赖 Node fetch。

SHE 原设计已经有稳定的 `launcher.mjs`，但有两个体验差距：

1. launcher 默认启动路径不检查更新，只有 `start.sh` 设置的
   `SHE_LAUNCHER_UPDATE_ON_START=1` 才检查；
2. launcher 下载使用 Node fetch，部分主机上会出现“curl 能下载、Node fetch
   报 fetch failed”的问题。

本次已对齐：

- launcher 默认每次启动检查 companion channel manifest；
- `SHE_LAUNCHER_UPDATE_ON_START=0` 可显式关闭启动检查；
- manifest/bundle 下载先走 Node fetch，失败自动回退系统 curl；
- 停止状态下发现新版本由 launcher 直接下载、SHA-256 校验、安装并启动新版本；
- 已运行状态下保留通过运行中 companion 受控 update API 更新的路径。

以后用户的正常动作可以是：

```text
关闭/重启 she-companion
或重新登录触发自启动
  → launcher 检查 manifest
  → 有更新自动下载安装
  → 启动新 companion
```

`start.sh` / `start.bat` 只用于：

- 首次安装 launcher；
- launcher 本身损坏/需要恢复；
- 从旧的非 supervisor 安装迁移；
- 启动脚本 artifact 本身需要刷新。

## 3. 本机实测

在仓库本机用临时 install root 完成真实 launcher 更新测试：

```text
初始 current: 0.0.1
manifest:     0.0.2
bundle:       local tar.gz + SHA-256
```

执行：

```sh
SHE_COMPANION_MANIFEST_URL=file:///tmp/.../manifest.json \
SHE_COMPANION_ROOT=/tmp/.../install \
SHE_PWA_PORT=18787 \
SHE_NO_BROWSER=1 \
node apps/companion/launcher.mjs
```

实测结果：

```text
[she-launcher] checking companion updates from file:///tmp/.../manifest.json
[she-launcher] installing companion 0.0.2 (current 0.0.1)
[she-launcher] starting companion 0.0.2 from /tmp/.../install
she-pwa listening on http://127.0.0.1:18787
```

验证：

```text
current -> versions/0.0.2
VERSION = 0.0.2
GET /api/health = ok
supervised = true
```

测试后已清理临时 install root 进程和目录。

## 4. 仍需注意

- 当前已安装的旧 launcher 不会凭空获得新代码；第一次安装带 curl fallback 和
  启动检查的新 launcher，仍需一次 `start.sh` / 恢复动作；
- 之后正常重启/自启动即可检查更新，不需要反复下载启动脚本；
- 正式让其他机器通过页面或启动 launcher 更新前，仍需发布新的 companion
  bundle 和 Pages channel manifest。
