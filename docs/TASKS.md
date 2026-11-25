# SHE 任务执行单

> 状态标记：`[ ]` 待做，`[~]` 进行中，`[x]` 完成，`[!]` 阻塞
> 执行原则：按依赖顺序逐项完成；每项至少包含实现、测试、文档三部分。

## M0 仓库与协议基线

| ID | 任务 | 依赖 | 状态 | 验收 |
|---|---|---|---|---|
| T0.1 | 初始化 pnpm workspace、tsconfig、vitest、基础包目录 | — | [x] | `pnpm typecheck` / `pnpm test` 可运行 |
| T0.2 | `@she/protocol` 公共类型：版本、capability、actor、conversation、错误码 | T0.1 | [x] | 类型导出完整；capability/错误测试通过 |
| T0.3 | gateway protocol v1：入站事件、命令、交互、RenderIntent、任务事件 | T0.2 | [x] | gateway 类型与契约测试通过 |
| T0.4 | agent protocol v1：session、prompt、cancel、event、health | T0.2 | [x] | adapter 契约类型完整 |
| T0.5 | sandbox protocol v1：spec、role、network、状态、stats、message | T0.2 | [x] | provider 契约类型完整 |
| T0.6 | `@she/core` 领域实体与 Topic/Task 状态机 | T0.2 | [x] | 状态迁移正例/负例测试通过 |
| T0.7 | gateway-sdk / agent-sdk / sandbox-sdk 公开接口骨架 | T0.3–T0.5 | [x] | fluent typecheck；接口文档 |
| T0.8 | 更新架构/兼容文档并记录决策 | T0.1–T0.7 | [x] | 文档与代码一致 |

## M1 控制面核心

| ID | 任务 | 依赖 | 状态 | 验收 |
|---|---|---|---|---|
| T1.1 | core ports：Clock/IdGenerator/Topic/Task/Artifact/Event store 接口 | T0.6 | [x] | 纯类型 + fake 实现测试 |
| T1.2 | 事件模型：task/app event、sequence、cursor、幂等键 | T0.3/T1.1 | [x] | 事件回放与 cursor 测试 |
| T1.3 | InMemory repository + `@she/control` TaskService | T1.1/T1.2 | [x] | submit/list/status/cancel 用例测试 |
| T1.4 | 串行 Topic 队列、租约、超时与恢复 | T1.3 | [x] | 并发/重入/租约测试 |
| T1.5 | `@she/store-sqlite` repository 实现与 schema migration | T1.1 | [x] | 重启恢复测试；无外部服务 |
| T1.6 | fake agent adapter 端到端闭环 | T1.3–T1.5 | [x] | 无网络任务闭环测试 |

## M2 OpenCode agent adapter

| ID | 任务 | 依赖 | 状态 | 验收 |
|---|---|---|---|---|
| T2.1 | OpenCode HTTP client：Basic auth、`/api/info`、prompt/status/cancel | T0.4 | [x] | fake HTTP 测试 |
| T2.2 | session create/resume、model/variant/permission 映射 | T2.1 | [x] | 会话复用与错误负例 |
| T2.3 | 报告/产物路径校验、超时、中断回收 | T1.6/T2.2 | [x] | 报告缺失/超限负例 |
| T2.4 | OpenCode adapter 与 control 组合测试 | T2.3 | [x] | 完整任务状态闭环 |

## M3 sandbox/broker

| ID | 任务 | 依赖 | 状态 | 验收 |
|---|---|---|---|---|
| T3.1 | `@she/sandbox-sdk` provider 接口与 `@she/client` broker client 契约 | T0.5 | [ ] | 契约测试 |
| T3.2 | `@she/broker` 独立 daemon：Unix socket、health、registry | T3.1 | [ ] | 0600/socket/health 测试 |
| T3.3 | fixed sandbox spec、Docker provider、start/stop/restart/destroy | T3.2 | [ ] | fake Docker runtime 测试 |
| T3.4 | inbox/outbox、artifactRef、路径/symlink 防护 | T3.3 | [ ] | 越权/逃逸负例 |
| T3.5 | audit/registry 持久化与重启恢复 | T3.2–T3.4 | [ ] | 重启恢复测试 |
| T3.6 | Linux/rootless 平台 provider 能力探测与支持矩阵 | T3.3 | [ ] | 宿主能力/路径/UID 负例测试 |
| T3.7 | macOS/Windows 平台适配设计（Docker Desktop/WSL2/named pipe） | T3.6 | [ ] | 设计文档 + 未验证项清单 |

## M4 feishu4dsh 薄接入

| ID | 任务 | 依赖 | 状态 | 验收 |
|---|---|---|---|---|
| T4.0 | feishu4dsh 评审回执与 canonical capability 对齐 | T0.8 | [x] | 13 个 v1 channel capability 锁定；评审回复文档 |
| T4.1 | `@she/client` handshake/health/command/interaction/events 实现 | T1.6 | [x] | fake Unix-socket server 契约测试通过 |
| T4.1a | `@she/protocol` / `@she/client` 打包发布、版本矩阵与 golden fixtures | T4.1 | [x] | 生成可安装 tarball；两仓库可引用同一 fixture 版本 |
| T4.1b | control-plane `/v1/*` server、事件重放窗口与 snapshot 入口 | T1.6/T4.1 | [x] | fake client 契约测试；cursor_expired 负例 |
| T4.2 | feishu4dsh 依赖 `@she/client` 的接入模块设计落地 | T4.1 | [ ] | 无 SHE 内部 import |
| T4.3 | `/she` 命令透传与只读 RenderIntent 映射 | T4.2 | [ ] | bridge/adapter 测试 |
| T4.4 | 写操作、交互回调、文件审批闭环 | T4.3 | [ ] | 联合验收用例 |
| T4.5 | 旧 secretary 兼容/迁移/回滚说明 | T4.4 | [ ] | 迁移文档 |

## M5 多 agent 与凭据

| ID | 任务 | 依赖 | 状态 | 验收 |
|---|---|---|---|---|
| T5.1 | dsh agent adapter（后置） | T2.4 | [ ] | adapter 契约测试 |
| T5.2 | 角色/调用关系/深度/fanout/预算策略 | T1.4 | [ ] | 策略负例测试 |
| T5.3 | model proxy / secret boundary | T4.4 | [ ] | 凭据不落盘测试 |
| T5.4 | 升级/回滚/审计与发布矩阵 | T4.5 | [ ] | 运维验收 |

## M6 PWA 本地控制台与安装/更新体验

| ID | 任务 | 依赖 | 状态 | 验收 |
|---|---|---|---|---|
| T6.1 | PWA 产品/信息架构与本地 API 契约 | M1 | [ ] | 页面、数据源、权限边界文档 |
| T6.2 | 本地 HTTP/SSE 服务与 PWA 静态骨架（manifest/service worker） | T6.1 | [ ] | localhost 可打开/可安装；health 可达 |
| T6.3 | Dashboard/agents/sandboxes/tasks 只读页面 | T6.2/M3 | [ ] | 信息来自 control plane，无重复状态源 |
| T6.4 | 软件包目录、下载、校验、显式确认安装/更新 | T6.3/T3.6 | [ ] | 校验、权限确认、日志、回滚入口 |
| T6.5 | Workspace 授权与只读/读写权限配置页 | T6.3 | [ ] | 只允许叶子目录；不可绕过 broker |
| T6.6 | Agent 对话/任务布置/报告与产物页面 | T6.3/M2 | [ ] | 与 CLI/gateway 共用同一控制面会话 |
| T6.7 | Gateway 配置与 feishu4dsh 连接状态页 | T6.3/M4 | [ ] | 不暴露/不读取飞书 secret 给 agent |
| T6.8 | 跨平台安装/更新向导与支持矩阵页面 | T6.4/T3.7 | [ ] | Linux 已验证；macOS/Windows 明确状态 |

## 当前执行记录

- 2026-11-25：完成 T0.1–T0.8，M0 基线完成。`pnpm typecheck` 通过，`pnpm test` 7/7 通过。
- 2026-11-25：完成 T1.1–T1.3：core ports、事件 cursor 模型、InMemory repository、TaskService submit/list/cancel 与幂等测试。`pnpm test` 13/13 通过。
- 2026-11-25：读取 feishu4dsh 新评审文档；完成 T4.0 capability 对齐与评审回复；提前完成 T4.1 `@she/client` Unix-socket health/hello/command/interaction/events 与 fake server 测试。`pnpm test` 18/18 通过。
- 2026-11-25：新增产品愿景文档，确认 PWA 本地控制台、sandbox workspace 授权、gateway 多渠道与 Docker 跨平台边界；新增 M6 任务组。
- 2026-11-25：完成 T1.4：Topic 串行队列、TaskLease、heartbeat、owner 校验、过期恢复与并发 claim 测试；新增 `docs/QUEUE-LEASE.md` 与 JSDoc。`pnpm test` 25/25 通过。
- 2026-11-25：完成 T1.5：`node:sqlite` store、schema migration、Topic/Task/Artifact/Lease/Event repository、跨重启恢复测试；新增 `docs/STORE-SQLITE.md`。`pnpm test` 29/29 通过。
- 2026-11-25：处理 feishu4dsh 第二轮反馈：新增 CardRenderIntent、commandResult.renderIntents、部署命名约定与发布矩阵；完成 T1.6 TaskRunner + fake agent adapter 端到端闭环；task_requests 迁移 v2。`pnpm test` 36/36 通过。
- 2026-11-25：完成 T4.1a：`pnpm pack:public` 脚本、golden fixtures、tarball 校验与 `docs/PUBLISHING.md`；已生成并记录 protocol/client tarball。
- 2026-11-25：完成 T4.1b：control-plane Unix-socket HTTP server、health/hello/command/interaction/snapshot/events、NDJSON、cursor_expired、bearer auth、默认命令服务与 CLI entrypoint；新增 `docs/CONTROL-PLANE-SERVER.md`。`pnpm test` 45/45 通过。
- 2026-11-25：完成 M2 T2.1–T2.4：OpenCode HttpApi client、AgentAdapter、permission 基线、async prompt 事件映射、报告校验、TaskRunner 组合测试；新增 `docs/OPENCODE-ADAPTER.md`。`pnpm test` 49/49 通过。下一步 M3 sandbox/broker。
