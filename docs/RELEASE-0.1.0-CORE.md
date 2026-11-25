# SHE core bundle 0.1.0

> 日期：2026-11-25
> Release：`v0.1.0-core.1`
> URL：`https://github.com/pancong0711/she/releases/tag/v0.1.0-core.1`

## 1. 资产

```text
she-core-0.1.0.tar.gz
release-manifest.json
```

SHA-256：

```text
abd0e40408cb3be0af98cb25419c14b3d60b7b6e66fd58bfe40130d5df9e5940  she-core-0.1.0.tar.gz
```

Manifest 下载地址：

```text
https://github.com/pancong0711/she/releases/download/v0.1.0-core.1/release-manifest.json
```

Bundle 下载地址：

```text
https://github.com/pancong0711/she/releases/download/v0.1.0-core.1/she-core-0.1.0.tar.gz
```

## 2. 内容

```text
she-core-0.1.0/
  control-plane.mjs
  broker.mjs
  run-core.sh
  run-core.cmd
  run-core.mjs
  VERSION
  bundle.json
  LICENSE
```

- `control-plane` 与 `broker` 是 esbuild 自包含 bundle；
- `run-core` 是 companion 唯一启动入口；
- 不包含 Node 运行时；
- 不包含 Docker；
- 不包含 PWA 静态资源；
- 不请求 root。

## 3. Companion 更新使用

PWA Install & Doctor 中默认 manifest URL：

```text
https://github.com/pancong0711/she/releases/download/v0.1.0-core.1/release-manifest.json
```

流程：

```text
检查更新
  → 读取 manifest
  → 下载 bundle
  → 校验 SHA-256
  → staging
  → 停止旧 core
  → 切换 current
  → 启动新 core
  → health check
  → 失败自动回滚 previous
```

## 4. 命令行安装

```sh
bash scripts/install-core-bundle.sh she-core-0.1.0.tar.gz \
  --sha256 abd0e40408cb3be0af98cb25419c14b3d60b7b6e66fd58bfe40130d5df9e5940 \
  --core-root ~/.local/share/she/core
```

启动：

```sh
~/.local/share/she/core/current/run-core.sh
```

## 5. 当前限制

- 更新安装脚本当前以 POSIX bash + tar 为主；Windows 原生路径后续补齐；
- companion 自身升级不由 core 更新流程处理；
- Docker/rootless runtime 不由 core bundle 安装；
- PWA 更新 UI 只执行显式用户确认后的用户级操作。
