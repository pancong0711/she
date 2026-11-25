# SHE companion bundle 0.1.0

> 日期：2026-11-25
> Release：`v0.1.0-companion.2`

## 1. 资产

```text
she-companion-0.1.0.tar.gz
companion-release-manifest.json
install-companion.sh
install-companion.ps1
```

Release URL：

```text
https://github.com/pancong0711/she/releases/tag/v0.1.0-companion.2
```

Manifest：

```text
https://github.com/pancong0711/she/releases/download/v0.1.0-companion.2/companion-release-manifest.json
```

Bundle SHA-256：

```text
de6f77fbc37414957550780011941cd0b23176b6d4b7d150152b7b90d5f91ea2  she-companion-0.1.0.tar.gz
```

## 2. 安装

```sh
bash install-companion.sh she-companion-0.1.0.tar.gz \
  --sha256 de6f77fbc37414957550780011941cd0b23176b6d4b7d150152b7b90d5f91ea2
```

安装位置：

```text
$XDG_DATA_HOME/she/companion/versions/0.1.0
$XDG_DATA_HOME/she/companion/current
$XDG_BIN_HOME/she-companion
```

默认 `XDG_DATA_HOME=~/.local/share`、`XDG_BIN_HOME=~/.local/bin`。

安装器：

- 不请求 root；
- 不执行 sudo；
- 不安装 Node/Docker；
- 校验 SHA-256；
- 保留版本目录；
- 写入用户级 launcher。

## 3. 安装后

```sh
she-companion
# 或
node ~/.local/share/she/companion/current/apps/companion/server.mjs
```

打开：

```text
http://127.0.0.1:8787
```

## 4. Companion 更新边界

- PWA 不会在线替换正在运行的 companion；
- `core-update` 只更新 core bundle；
- companion 自身升级必须下载新的 companion release，并使用 checksum-verified installer；
- 旧 companion 版本目录保留，可手工回滚；
- 不请求 root、不写系统目录。

## 5. 内容

```text
she-companion-0.1.0/
  apps/companion/server.mjs
  apps/companion/package.json
  apps/pwa/dist/
  scripts/bootstrap-user.sh
  scripts/bootstrap-user.ps1
  scripts/install-core-bundle.sh
  scripts/install-companion.sh
  scripts/install-companion.ps1
  bin/she-companion
  VERSION
  LICENSE
  README.md
```

## 6. 当前限制

- Windows 安装脚本已有基础实现，但需 Windows 真机验收；
- 还没有 OS code signing / GPG signature；当前使用 SHA-256 manifest；
- companion 不会自动启动 core，用户需在 PWA 中点击启动或手工运行；
- Docker/rootless 系统 runtime 仍需用户自行安装。
