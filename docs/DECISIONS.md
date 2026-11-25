# SHE 已确认决策

> 日期：2026-11-25

1. 项目在独立仓库 `<local-workspace>` 开发，项目名为 `she`。
2. gateway、agent、sandbox 作为三个边界平面，控制面核心独立存在。
3. feishu4dsh 继续负责飞书 gateway adapter；SHE 不实现飞书 SDK。
4. feishu4dsh 依赖 SHE 发布的 `@she/protocol` / `@she/client` 公开包；SHE 不反向依赖 feishu4dsh。
5. 包版本使用 semver；`0.x` 阶段 feishu4dsh 建议锁定 `~0.x`，协议版本独立协商。
6. broker 从首期即作为独立 daemon / 信任边界设计。
7. 首期 agent adapter 只实现 OpenCode；dsh adapter 后置，不影响 feishu4dsh 接入 SHE。
8. 控制面 API 采用本机 Unix socket 上的版本化请求/响应协议，事件流使用 cursor 语义；具体 JSON-RPC/HTTP/SSE 编码在 T1 阶段实现。
9. 核心测试不依赖飞书、Docker、真实凭据或外部网络。
