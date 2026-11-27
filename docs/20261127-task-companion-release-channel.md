# 任务单：Companion 独立更新通道

> 日期：2026-11-27
> 状态：执行中

## 问题

用户新安装或升级时仍得到 companion 0.7.2，而不是 0.7.5。

## 根因

`start.sh` / `start.ps1` 使用 GitHub 仓库级：

```text
https://github.com/pancong0711/she/releases/latest/download/...
```

但仓库同时发布三种 Release：

- companion；
- core；
- public packages。

发布 `v0.1.0-packages.2` 后，GitHub 的 “Latest” 指向 packages release，
导致 `releases/latest/download/companion-release-manifest.json` 为 404。
已有本地 launcher 会把启动脚本导入 fallback，因此可能继续运行旧的 0.7.2。

## 设计

为 companion 建立独立、稳定的发布通道：

```text
start.sh / start.ps1
  → https://pancong0711.github.io/she/companion-release-manifest.json
  → launcher.url / bundle.url（绝对 GitHub Release URL）
  → 当前 companion bundle
```

- channel manifest 由 companion 构建生成，并提交到 PWA public；
- manifest 内包含绝对 `bundle.url` 与 `launcher.url`；
- start 脚本不再依赖仓库级 `releases/latest`；
- launcher 默认使用 Pages channel manifest；
- PWA 更新检查也使用 Pages channel manifest；
- core/packages release 不再可能影响 companion 更新通道。

## 验收

- [x] `start.sh` 无固定 companion 版本号、无硬编码 tag；
- [x] `start.ps1` 无固定 companion 版本号、无硬编码 tag；
- [x] release manifest 同时包含相对文件名与绝对 URL；
- [x] launcher 优先使用绝对 bundle URL；
- [x] Pages 提供 `companion-release-manifest.json`；
- [x] 测试保证 channel manifest 版本与 companion package 版本一致；
- [x] 本地模拟新安装安装到当前最新版本；
- [x] 发布 companion 0.7.6，并标记 Companion release 为 Latest；
- [x] 发现 0.7.6 launcher URL 校验仍拒绝 Pages manifest，补发并验证 0.7.7。
- [x] 文档写明 core/packages release 不应抢占 latest。
