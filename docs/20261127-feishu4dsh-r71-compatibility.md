# feishu4dsh R71 与 SHE gateway.v1 兼容性核查

> 日期：2026-11-27
> 状态：SHE 侧兼容结论与待办
> 对方实现：`20261127-需求-r71-SHE-gateway-v1适配.md`

## 1. 结论

feishu4dsh R71 的方向与 SHE 当前 `gateway.v1` 契约一致。基础链路不需要改协议：

```text
飞书消息
  → feishu4dsh /she 透传
  → @she/client
  → SHE control-plane gateway.v1
  → RenderIntent / task event
  → feishu4dsh 飞书渲染
```

已对齐的契约：

| 能力 | feishu4dsh R71 | SHE 现状 | 结论 |
|---|---|---|---|
| health + hello | 有 | `/v1/health`、`/v1/hello` | 兼容 |
| protocol v1 | `gateway.v1` | `gateway.v1` | 兼容 |
| `/she` 透传 | 有，不解析子命令 | command service 负责 | 兼容 |
| actor/conversation/replyTo | 有 | 协议类型已有 | 兼容 |
| interaction/card form | 有 | `/v1/interactions` | 兼容 |
| RenderIntent | text/card/form/approval/file | 协议已有 | 兼容 |
| task events | accepted/progress/completed/failed/artifact | control-plane event mapper 已有 | 兼容 |
| cursor/snapshot | 有 | `/v1/events?cursor=`、`/v1/snapshot` | 兼容 |
| token file | 0600/0400 | core token 在 `~/.config/she/token` | 兼容 |
| artifact list/download | 当前仍是文本降级 | 公开 client 已有 `artifacts()` / `downloadArtifact()` | SHE 已补齐；feishu4dsh 待接入 |

因此：**可以良好兼容，且不需要恢复 feishu4dsh 内的 SHE 业务实现。**

## 2. 新需求

### 2.1 SHE：发布新的公开包

R71 以 GitHub Release tarball `v0.1.0-packages.1` 为基线。该基线之后的
`@she/client` 已增加：

```ts
client.artifacts(taskId): Promise<readonly ArtifactListItem[]>
client.downloadArtifact(artifactId): Promise<{
  bytes: Uint8Array
  contentType: string | undefined
  contentDisposition: string | undefined
}>
```

需要发布新的 public package Release，并把兼容矩阵更新到：

```text
@she/protocol 0.1.0
@she/client   0.1.1
gateway.v1
```

feishu4dsh 更新依赖 URL 后，才能把 file intent / artifact 从“明确降级”变为真正发送。

### 2.2 feishu4dsh：把 artifact 下载接到 Feishu port

当前 `src/integrations/she/adapter.ts` 在缺少 `sendFile` 时仍显示：

```text
installed @she/client exposes no artifact download API
```

在新包下这条降级不再成立。建议完成：

1. `SheRuntimeClient` 增加 `artifacts` / `downloadArtifact`；
2. `createFeishuSheRenderPort()` 接收下载器与 `sendFile` 能力；
3. 群聊仍走 feishu4dsh 的逐次文件审批；
4. 超限、下载失败、无权限时降级为明确文本，不伪造成功；
5. 不要把 SHE token、socket 或宿主绝对路径发给飞书。

可选：监听 `artifact.created` 后发送报告文件。注意报告文件也不应绕过群聊审批，
并且需要 `maxSendFileBytes` 限制。

### 2.3 联合真机验收

feishu4dsh R71 当前仍是“代码/契约测试完成，待真机”。需要按以下顺序验收：

1. 启动 SHE core，确认 `$XDG_RUNTIME_DIR/she/control.sock` 和 token 权限；
2. feishu4dsh `she.enabled: true`；
3. 私聊 `/she status`、`/she list`；
4. `/she submit` -> taskId -> task events -> 最终回复；
5. 群聊 approval/card interaction；
6. artifact/file 发送与群聊审批（完成 2.2 后）；
7. 停掉 SHE 后普通 dsh 聊天不受影响，`/she` 返回明确错误；
8. protocol/capability 负例明确失败。

## 3. 运行配置

SHE 默认路径：

```text
socket: $XDG_RUNTIME_DIR/she/control.sock
token:  ~/.config/she/token
```

feishu4dsh：

```yaml
she:
  enabled: true
  # socket: /run/user/1000/she/control.sock
  # tokenFile: /home/me/.config/she/token
```

注意：

- 内置 SHE Feishu gateway 与 feishu4dsh adapter 不应同时绑定同一个飞书应用，
  否则会产生重复回复；
- 二者选其一：内置 gateway 为短期 fallback，feishu4dsh 是完整 channel adapter；
- `she.enabled: false` 时普通飞书聊天必须完全不依赖 SHE。

## 4. 安全边界

- feishu4dsh 只依赖公开 `@she/protocol` / `@she/client`；
- 不 import SHE core/control/store/broker；
- 不在 feishu4dsh 复制 SHE 任务状态机；
- 飞书 App Secret 不传给 SHE；
- SHE token 不进入 agent 环境或日志；
- artifact 下载必须有大小上限，并遵守群聊文件审批；
- `file` intent 不能把宿主绝对路径传出去，只能传 artifact id 或 bytes。

## 5. 当前评审结论

```text
协议：兼容
基础命令/卡片/事件：兼容
文件/artifact：SHE 已提供 API，feishu4dsh 待接入
真机：待联合验收
```
