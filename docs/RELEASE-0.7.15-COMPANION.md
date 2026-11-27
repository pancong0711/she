# SHE companion 0.7.15（SHE App Shell）发布说明

> Release：`v0.7.15-companion.1`
> 日期：2026-11-27

## 修复

### Sandbox 创建把 UI 提示文案当成 Docker 命令

选择 Agent recipe 后，PWA 曾把提示文案：

```text
由 Agent recipe 在容器启动时安装并保持运行
```

写入 `sandboxDraft.command`。当 recipe 选择状态丢失或切回系统镜像时，这段文案
会被 `parseCommandLine` 当作 Docker command 传给 broker，最终变成：

```text
docker run ... node:24-bookworm 由 Agent recipe ...
```

Docker 拉取镜像后会尝试执行 `由`，因此创建失败。

修复：

- recipe 选中时 UI 状态不再写入提示文案；
- 创建提交时统一通过 `sandboxCommandForCreate()` 解析命令；
- 有 recipe 时始终使用固定的 `bootstrap.command`；
- 无 recipe 时如果检测到旧占位文案，自动降级为 `sleep infinity`；
- 增加回归测试，确保提示文案不会进入 Docker argv。

## 验证

```text
tsc -b                         ✓
vue-tsc --noEmit               ✓
Vitest                         ✓ 40 files / 135 tests
PWA / companion bundle build   ✓
```

Core 保持 0.3.4。
