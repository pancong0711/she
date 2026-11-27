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
| T3.1 | `@she/sandbox-sdk` provider 接口与 `@she/client` broker client 契约 | T0.5 | [x] | 契约测试 |
| T3.2 | `@she/broker` 独立 daemon：Unix socket、health、registry | T3.1 | [x] | 0600/socket/health 测试 |
| T3.3 | fixed sandbox spec、Docker provider、start/stop/restart/destroy | T3.2 | [x] | fake Docker runtime 测试 |
| T3.4 | inbox/outbox、artifactRef、路径/symlink 防护 | T3.3 | [x] | 越权/逃逸负例 |
| T3.5 | audit/registry 持久化与重启恢复 | T3.2–T3.4 | [x] | 重启恢复测试 |
| T3.6 | Linux/rootless 平台 provider 能力探测与支持矩阵 | T3.3 | [ ] | 宿主能力/路径/UID 负例测试 |
| T3.7 | macOS/Windows 平台适配设计（Docker Desktop/WSL2/named pipe） | T3.6 | [ ] | 设计文档 + 未验证项清单 |

## M4 feishu4dsh 薄接入

| ID | 任务 | 依赖 | 状态 | 验收 |
|---|---|---|---|---|
| T4.0 | feishu4dsh 评审回执与 canonical capability 对齐 | T0.8 | [x] | 13 个 v1 channel capability 锁定；评审回复文档 |
| T4.1 | `@she/client` handshake/health/command/interaction/events 实现 | T1.6 | [x] | fake Unix-socket server 契约测试通过 |
| T4.1a | `@she/protocol` / `@she/client` 打包发布、版本矩阵与 golden fixtures | T4.1 | [x] |
| T4.1c | GitHub Release tarball 发布（protocol/client/gateway-sdk）与消费说明 | T4.1a | [x] | Release 资产、SHA、pnpm overrides 示例 | 生成可安装 tarball；两仓库可引用同一 fixture 版本 |
| T4.1b | control-plane `/v1/*` server、事件重放窗口与 snapshot 入口 | T1.6/T4.1 | [x] | fake client 契约测试；cursor_expired 负例 |
| T4.2 | feishu4dsh 依赖 `@she/client` 的接入模块设计落地（SHE 侧参考 bridge + guide） | T4.1 | [x] | 无 SHE 内部 import |
| T4.3 | `/she` 命令透传与只读 RenderIntent 映射（契约/参考桥测试） | T4.2 | [x] | bridge/adapter 测试 |
| T4.4 | 写操作、交互回调、文件审批闭环（SHE 契约侧） | T4.3 | [x] | 联合验收用例 |
| T4.5 | 旧 secretary 兼容/迁移/回滚说明 | T4.4 | [x] |
| T4.6 | feishu4dsh 仓库实际接入与飞书真机验收 | T4.2–T4.5 | [ ] | 目标仓库 patch + 真机闭环 | 迁移文档 |

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
| T6.1 | PWA 产品/信息架构与本地 API 契约 | M1 | [x] | 页面、数据源、权限边界文档 |
| T6.2 | 本地 HTTP/SSE 服务与 PWA 静态骨架（manifest/service worker） | T6.1 | [x] |
| T6.2a | GitHub Pages PWA 部署与静态/companion 双模式连接 | T6.2 | [x] | Pages URL 可安装；可连接 127.0.0.1 companion | localhost 可打开/可安装；health 可达 |
| T6.3 | Dashboard/agents/sandboxes/tasks 只读页面 | T6.2/M3 | [~] |
| T6.3a | Sandboxes 只读页面与 broker `/broker/v1/*` 代理 | T6.3 | [x] | list/status/stats；broker 离线提示 |
| T6.3b | Agent/OpenCode health 与 workspace 授权只读列表 | T6.3 | [x] | 只读 health/授权来源 | 信息来自 control plane，无重复状态源 |
| T6.4 | 软件包目录、下载、校验、显式确认安装/更新 | T6.3/T3.6 | [~] |
| T6.4e | Packages 页面：companion/core/runtime 清单与操作入口 | T6.4c3/T7.6 | [x] | `/api/packages` + PWA 卡片；不伪造安装状态 |
| T6.4a | Companion Install & Doctor：白名单 job runner、环境检查、依赖/构建/测试、实时日志 | T6.2a | [x] |
| T6.4b | 安装前 preflight 硬门禁与环境结果 API | T6.4a | [x] | Node/pnpm fail 阻断 install；PWA 实时显示 |
| T6.4c1 | 用户级 Node/pnpm bootstrap（不请求 root） | T6.4b | [x] | `bootstrap-user.sh`/`.ps1`；companion `bootstrap` job |
| T6.4c2 | signed companion installer 与平台安装向导 | T6.4c1/T7.4 | [x] |
| T6.4c3 | PWA 一键 launcher（start.bat / start.command / start.sh） | T6.4c2 | [x] | 下载后自动校验/安装/启动/打开浏览器；不请求 root | checksum/签名、无 root、可回滚 |
| T6.4d | 特权环境（Docker/rootless/系统依赖）instructions-only 支持矩阵 | T6.4b | [x] | 只展示方法；不执行 sudo/不请求 root | 显式同意、checksum、审计、回滚 | PWA 点击触发并实时显示 stdout/stderr | 校验、权限确认、日志、回滚入口 |
| T6.5 | Workspace 授权与只读/读写权限配置页 | T6.3 | [~] | 只允许叶子目录；不可绕过 broker | 授权注册表/PWA 页面完成；Agent Migration 绑定完成；worker 直接模式待统一 |
| T6.6 | Agent 对话/任务布置/报告与产物页面 | T6.3/M2 | [~] | 首版 report artifact 完成；任意工具输出/二进制产物待补 |
| T6.6a | Agent worker + PWA Chat：提交、事件流、实时 text/tool 状态 | T6.6/M2 | [x] | worker+OpenCode+agent.delta 实测 |
| T6.6b | PWA Settings：worker/OpenCode/workspace 配置与重启应用 | T6.6a | [x] | 0600 config；密码仅路径；core restart 后生效 | 与 CLI/gateway 共用同一控制面会话 |
| T6.7 | Gateway 配置与 feishu4dsh 连接状态页 | T6.3/M4 | [~] | 不暴露/不读取飞书 secret 给 agent | 配置/health/secret boundary 页面完成；真机联调待 T4.6 |
| T6.8 | 跨平台安装/更新向导与支持矩阵页面 | T6.4/T3.7 | [~] | Linux 已验证；macOS/Windows 明确状态 | 平台探测与矩阵页面完成；安装向导/真机验收未完成 |
| T6.9 | 本机 AI agent 发现、容器化迁移计划、凭据目录只读挂载与迁移记录 | T6.3/T3.3/T3.5 | [x] | 发现不读凭据内容；根目录 workspace 阻断；broker host mount 负例测试；PWA 勾选/配置/执行 |
| T6.10 | 用户级 companion 登录自启动与安装版开发者工具隐藏 | T6.4/T7.8 | [x] | 不写系统服务、不请求 root；安装版不执行源码依赖安装 |
| T6.11 | Packages Sandbox 镜像下拉、默认资源和卡片等高滚动 | T6.4e | [x] | 镜像预设/自定义、默认网络/资源、本机镜像检测；Agent Migration 使用默认值 |
| T6.12 | Headless persistence 环境检查：systemd --user、linger、companion autostart、OpenCode/Feishu health | T6.10/T6.3b | [x] | 无登录运行建议、修复命令、persistenceReady 摘要 |
| T6.13 | Sandboxes 创建表单与 Agent Migration 镜像/网络/资源说明 | T6.3/T6.9 | [x] | PWA 调用 broker create；说明镜像/命令/网络/挂载/资源 |
| T6.14 | Sandbox 启动命令解析、CPU/内存/PID/网络语义与 worker/agent 边界说明 | T6.13 | [x] | 引号命令不被错误拆分；worker 明确不在 sandbox；Chat 快速验证入口 |
| T6.15 | feishu4dsh 安装前置检查与 PWA 受控 dsh 插件安装 | T6.7/T4.6 | [~] | 不读 secret；无 sudo；不自动装服务；真机联调待 T4.6 |
| T6.16 | Agent Runtime Recipe：预构建 agent 镜像、digest 锁定与 sandbox 路由 | T6.13/T5.2 | [ ] | 不在只读 rootfs 自动安装；secret 不进镜像；失败回滚 |
| T6.4f | Packages 依赖目录与缺失依赖安装指引 | T6.4e | [x] | requirement/用途/状态/安装命令/官方文档；不自动执行系统安装 |

## M7 Companion / Core 分层与自更新

| ID | 任务 | 依赖 | 状态 | 验收 |
|---|---|---|---|---|
| T7.1 | 定稿 companion/core ADR 与 `companion-api.v1` 契约 | M6 | [x] | ADR-0001 + API 契约文档 |
| T7.2 | 从 `apps/pwa/server.mjs` 抽出 `apps/companion` | T7.1 | [x] | companion 不 import core 内部 |
| T7.3 | 定义 `run-core` 入口与 release manifest schema | T7.1 | [x] | core 可由 companion 以稳定入口启动 |
| T7.4 | core bundle 打包、版本目录、current/previous | T7.3 | [x] | `she-core-<version>` 可安装/切换 |
| T7.5 | staging/pending/停止/切换/健康检查/回滚 | T7.4 | [x] | 更新失败自动回滚 |
| T7.6 | PWA 更新 UI 与实时阶段日志 | T7.5 | [x] | 下载/安装/重启/回滚进度可见 |
| T7.7 | companion 自身升级边界 | T7.2 | [x] | PWA 不替换运行中的 companion |
| T7.8 | supervisor 管理的 companion 页面内重启/停止/更新 | T7.7 | [x] | 版本可见；checksum；失败回滚；非 supervisor 模式禁用 |

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
- 2026-11-25：完成 M2 T2.1–T2.4：OpenCode HttpApi client、AgentAdapter、permission 基线、async prompt 事件映射、报告校验、TaskRunner 组合测试；新增 `docs/OPENCODE-ADAPTER.md`。`pnpm test` 49/49 通过。
- 2026-11-25：完成 M3 T3.1–T3.5：broker daemon、DockerRuntime/CLI、固定 sandbox 路径、registry/audit、inbox/outbox 路由与 symlink 防护、SandboxBrokerClient 与 Unix-socket 集成测试；新增 `docs/SANDBOX-BROKER.md`。`pnpm test` 52/52 通过。
- 2026-11-25：完成 M4 SHE 侧：`SheGatewayBridge`、命令/交互/RenderIntent/task event 转发、approval/file intent 契约测试、feishu4dsh 接入指南与 secretary 迁移/回滚文档。`pnpm test` 54/54 通过。feishu4dsh 仓库实际 patch 与真机验收列为 T4.6。
- 2026-11-25：完成 M6 T6.1–T6.2：Vue 3 + Vite PWA、manifest/service worker、本地 127.0.0.1 host、/v1 反向代理、health/snapshot 只读 Dashboard 与 Tasks 表；新增 `docs/PWA.md`。
- 2026-11-25：完成 T6.2a：GitHub Pages PWA 部署工作流、相对 base、首次使用向导、companion URL 配置、CORS/PNA 支持。Pages 静态页面可安装并可连接本地 `127.0.0.1:8787` companion。
- 2026-11-25：完成 T6.3a：PWA 增加 `/broker/v1/*` 代理、Sandboxes 只读列表/status/按需 stats、broker 离线提示；补充 PNG 192/512 安装图标。
- 2026-11-25：完成 T6.4a：PWA Install & Doctor 页面、companion `/api/jobs` 白名单任务、环境检查/依赖安装/构建/测试和实时 NDJSON 日志；修复离线状态下导航看起来无响应的问题。
- 2026-11-25：响应 feishu4dsh integration 建议：`@she/gateway-sdk` 纳入公开包；发布 GitHub Release tarball `v0.1.0-packages.1`；补充 tarball + pnpm overrides/`blockExoticSubdeps:false` 消费说明与 SHA；完成 Release URL 安装 smoke test。
- 2026-11-25：新增 ADR-0001，确定 stable companion + updatable core + versioned protocol 分层；M7 任务组建立。
- 2026-11-25：完成 T7.2/T7.3：抽出 `apps/companion`，新增 companion-api v1、`/api/version`、`/api/capabilities`、`/api/core/status`，新增 `run-core` 参考入口与 release manifest 生成器；新增 `docs/COMPANION-CORE-CONTRACT.md`。
- 2026-11-25：完成 T6.4b：install 前强制 preflight；Node/pnpm 版本 fail 阻断；新增 `/api/preflight`、实时检查事件和 `docs/ENVIRONMENT-BOOTSTRAP.md`。
- 2026-11-25：新增 ADR-0002 与 T6.4d：SHE 不执行/不请求 root；preflight 检查 uid 与 Docker rootless 状态；Docker 组权限标记 root-equivalent warning；需要 root 的安装只展示方法。
- 2026-11-25：完成 T6.4c1：新增用户级 `bootstrap-user.sh`/`.ps1` 与 companion `bootstrap` job；仅用户目录安装 pnpm，不执行 sudo，不安装 Docker；PWA 增加“用户级环境准备”按钮并复跑 preflight。
- 2026-11-25：完成 T7.4：esbuild core bundle、`run-core` 双服务启动、release manifest、`install-core-bundle.sh` 用户级版本目录与 current/previous；bundle 实际启动与 socket health 验证通过。
- 2026-11-25：完成 T7.5/T7.6：companion core supervisor、manifest 检查、staging/SHA 校验、停止/切换/启动/health check/自动回滚；PWA 增加 core 启停、版本、更新检查和实时更新日志。成功更新与失败回滚均已实测。
- 2026-11-25：发布 core bundle `v0.1.0-core.1`，提供 `release-manifest.json` 与 `she-core-0.1.0.tar.gz`；PWA 默认 manifest URL 指向该 Release。
- 2026-11-25：完成 T6.4c2/T7.7：companion bundle 构建、checksum-verified 用户级安装器、manifest、PWA 下载入口与 companion 自身升级边界；安装后 companion 实际启动和 PWA 静态/API smoke test 通过。
- 2026-11-25：完成 T6.4c3：PWA 增加 `start.bat`/`start.ps1`/`start.command`/`start.sh` 一键 launcher；从 Release 下载 manifest/bundle、校验 SHA、安装 companion、启动并打开页面；实测 start.sh 完整链路通过。
- 2026-11-25：完成 T6.4e：companion `/api/packages` 与 PWA Packages 页面，展示 companion/core/Node/pnpm/Docker 状态，并接入 launcher、core 更新和用户级 pnpm 准备入口。
- 2026-11-25：完成 T6.6a：control-plane worker（OpenCode adapter）、task.agent_event 持久化、gateway agent.delta 映射、PWA Chat 实时对话/任务布置；fake OpenCode worker smoke 通过。
- 2026-11-25：完成 T6.6b：PWA Settings 编辑 worker/OpenCode/workspace/model/poll/lease 配置，写入 0600 worker.json；companion 启动 core 时注入 SHE_* 环境变量；保存并重启 core 后 worker 实际执行任务成功。

- 2026-11-26：完成 T6.9 首版：companion 只读扫描本机 AI agent 进程/端口/cwd/配置目录，新增迁移计划与 `agent-migrate` allowlisted job；PWA 增加 Agent Migration 页面，可勾选服务、配置 new/reuse workspace、`/legacy` 只读、凭据目录只读挂载、镜像/网络/资源；broker 增加受约束 host mount 与 command 支持，自动回滚本次已创建 sandbox。`pnpm test` 61/61 通过。

- 2026-11-26：改进 preflight 信息质量：新增 requirement/feature/remediation 字段，区分 required toolchain 与 sandbox/Docker 能力；Docker 缺失时显示 `sandboxReady=false`、具体原因和平台安装指引；bootstrap/doctor 的 job 即使退出 0 也显示 warning 数量，避免“succeeded”被误读为全部能力就绪。

- 2026-11-26：完成 T6.4f：Packages 扩展为 12 项依赖目录，新增 Node/pnpm/git/bash/curl/tar/SHA-256/Docker/OpenCode 等状态、用途、requirement、平台化安装命令、复制按钮和官方文档链接；补齐 `docs/PACKAGES.md`。

- 2026-11-26：优化 Install & Doctor 信息架构：Core 未安装时在 Dashboard、Core 卡片和 Packages 中提供明确“安装 Core”按钮；启动/停止/重启按钮在未安装时禁用；将“安装依赖/构建 PWA/构建 TypeScript/运行测试”移入“仅源码仓库使用”的开发者工具折叠区，并明确正常安装用户无需执行。

- 2026-11-26：完成 T6.3b：control-plane 新增 `GET /v1/agents` 与 `SheClient.agents()`，返回 OpenCode `/api/info` health、worker 配置、凭据文件路径（不返回内容）和 workspace realpath/r-w-x/readOnly/leafAuthorized 只读视图；PWA 新增 Agents 页面。

- 2026-11-26：T6.8 部分完成：新增 companion `/api/platform` 平台探测（OS/arch/Node/shell/uid/WSL/Docker mode）与 Linux/macOS/Windows 支持矩阵；Install & Doctor 新增平台能力卡片，明确 verified / implemented-unverified / design-only / unsupported；新增 `docs/PLATFORM-SUPPORT.md`。

- 2026-11-26：T6.5 首版：新增 companion workspace 授权注册表 `~/.config/she/workspaces.json`（0600）与 `/api/workspaces` CRUD；校验 realpath、叶子目录、root/home/系统路径、r/w 权限；PWA 新增 Workspaces 页面。实际只读强制仍由 broker host mount 执行；Agent Migration 与 worker 绑定授权 ID 列为后续。

- 2026-11-26：修复 companion 版本与 root/core 耦合导致的 launcher 不更新问题：companion bundle/manifest 改用 `apps/companion/package.json` 版本，升级到 0.2.0；launcher 默认 Release tag 更新为 `v0.2.0-companion.1`；PWA 增加最低 companion 版本提示；service worker 对导航和 start.* 改为 network-first，避免缓存旧 launcher。

- 2026-11-26：发布 companion 0.2.1，修复 127.0.0.1 本地 PWA 与 Pages 版本割裂：start.* 和 manifest 使用 no-cache，service worker 对导航/launcher 使用 network-first；launcher 默认 tag 与最低 companion 版本同步更新。

- 2026-11-26：完成 T7.8：新增 companion supervisor（退出码 75 重启、20 秒启动窗口、pending rollback）；PWA Settings 显示 companion 版本并支持页面内重启/停止/检查更新/安装并重启；更新仅接受 SHE GitHub Release manifest，校验 SHA-256，非 supervisor 模式禁用。实际验证 0.3.0→0.3.1 更新成功、故意启动失败回滚到 0.3.0。

- 2026-11-26：完成 T6.5 迁移绑定：Agent Migration 的 reuse/legacy 来源必须选择 Workspaces 授权 ID；reuse 要求 read-write，new+/legacy 可用 read-only；计划与迁移记录保存 workspaceAuthorizationId；broker 继续二次校验并强制只读。PWA 迁移面板改为授权下拉选择。

- 2026-11-26：完成 T6.10：新增 `/api/autostart` 与 Settings 登录自启动开关（Linux systemd --user/XDG、macOS LaunchAgent、Windows Startup）；安装版 companion 检测 `sourceCheckout=false` 并隐藏/阻断源码安装/构建/测试 job；Docker 安装指引按 Ubuntu/Debian/Fedora/Arch/macOS/Windows 生成具体命令。

- 2026-11-26：T6.7 首版：新增 `/api/gateway` 与 PWA Gateway 页面；配置仅保存 loopback adapter health URL，显示 control-plane gateway.v1 状态与 adapter health；明确飞书 secret 由 feishu4dsh 持有。

- 2026-11-26：T6.6 首版：TaskRunner 成功任务自动生成 Markdown report artifact（workspace/.she/reports），写 artifact repository 与 artifact.created 事件；control-plane 新增 artifact list/download API；PWA Chat 显示报告下载链接。

- 2026-11-26：修复 core update `version already installed`：Core 更新安装增加 `--force`，安装失败自动回滚；新增 control-plane `/v1/admin/shutdown` 与 companion 外部 core 检测，停止/重启可重新接管遗留 core；core 升级 0.2.1，companion 升级 0.3.6。

- 2026-11-26：完成 T6.11：Packages 增加 Sandbox 镜像下拉（Node/Ubuntu/Debian/Alpine/Python + 自定义）、默认网络/CPU/内存/PIDs、本机镜像检测与 `docker pull` 提示；Agent Migration 自动读取默认值；Packages 卡片等高并支持内部滚动；Chat 增加单 worker 限制提示。

- 2026-11-26：完成 T6.12：preflight 增加 systemd --user、linger、Companion 登录自启动、OpenCode health 和已配置 feishu4dsh health；环境摘要新增 headless persistence 状态和修复入口；新增 `docs/HEADLESS-PERSISTENCE.md`。

- 2026-11-26：T6.13：Sandboxes 页面新增新建表单并调用 broker `POST /v1/sandboxes`；Agent Migration 镜像改为 Packages 预设下拉+自定义；补充 `/legacy`、凭据只读、bridge/none、启动命令和资源建议说明。

- 2026-11-26：T6.14/T6.15 首版：修复 PWA 启动命令引号解析；Sandboxes/Agent Migration 增加 CPU、memory、PIDs、bridge/egress、启动命令和镜像解释；Settings 明确 worker 在 core 宿主进程、不在 sandbox，并增加 Chat 快速验证入口；新增 `/api/feishu4dsh` 只读前置检查和 `feishu4dsh-install` 受控 dsh 插件安装 job；Gateway 增加安装/连接清单，明确安装插件不等于 SHE 已接通飞书（T4.6 仍待完成）；新增 `docs/AGENT-RUNTIME-RECIPES.md`。

- 2026-11-26：修复 worker 状态和 OpenCode 连接发现：TaskRunner 增加 `onClaim`，worker 在任务 claim 后立即显示 `running`；companion 新增 OpenCode `--service` state 文件发现（URL/health/凭据路径，不返回密码），旧默认 `49375 + ~/.config/opencode/service.json` 自动跟随当前 live service（如 49374）；Settings 增加检测状态和“使用检测到的服务”；Chat/Tasks 显示 task 失败详情；Core 启动/重启按 control-plane + broker health 给出真实成功/失败结果。发布 core 0.2.3 与 companion 0.4.9。

- 2026-11-26：完成 sandbox agent 安装与命令执行首版：broker 新增 `sandbox.exec` capability、`POST /v1/sandboxes/:name/exec`、固定容器 HOME/PATH/NPM prefix、超时/输出截断与审计；PWA Sandboxes 增加 Agent recipe 创建时 bootstrap（OpenCode/dsh/Hermes/Pi，固定版本）、卡片内“安装 Agent / 验证 / 执行命令”；安装写入 `/home/agent/.local`，不修改只读 rootfs；新增 `apps/companion/sandbox-agent-recipes.mjs`。发布 core 0.3.0 与 companion 0.5.0。

- 2026-11-26：完成 SHE 内置 Feishu gateway 首版，不再默认依赖 dsh/feishu4dsh：新增 `apps/feishu-gateway`（官方 Lark SDK WebSocket + `@she/client`），companion 新增 `/api/feishu/gateway/status|config|start|stop`，PWA Gateway 支持 App ID/Secret 0600 配置、连接/停止、allowlist 和日志；支持 `/she` 文本命令与 task accepted/completed/failed 回传；修复 start.sh/start.ps1 固定旧 tag 和 PWA update manifest 固定旧 Release 的问题，launcher/更新检查改为 `releases/latest/download`。发布 companion 0.6.0。

- 2026-11-26：Agent 版本管理首版：Sandbox agent 版本可手填；新增 registry 版本解析（精确存在则使用，不存在回退最新稳定版，网络不可用时标记未验证）；新增 `~/.config/she/agent-versions.json`（0600），每个 agent 保留最近 5 个成功安装版本；Agent 安装改为版本目录 `/home/agent/.agents/<agent>/<version>` + current symlink；新增 `docs/SANDBOX-LIFECYCLE.md` 说明 stop/start/restart/destroy 与 workspace 关系；Sandbox 选择器改为 Agent/系统镜像一级、版本/镜像二级。

- 2026-11-26：完成 Agent 版本管理：手填版本 + registry 校验 + 不存在回退 latest + 成功版本注册表（每 agent 最近 5 个）；安装改为 `/home/agent/.agents/<agent>/<version>` 多版本目录；OpenCode 内置推荐版本加入 2.4.2；Sandbox 创建/安装选择器两级化；新增 `docs/SANDBOX-LIFECYCLE.md`。发布 companion 0.7.0。

- 2026-11-27：OpenCode v2 安装包切换为 `@opencode/cli`，解决 2.4.2 版本校验找不到的问题；Settings 检测新增 `/api/model` 模型列表和一键填入 provider/model；重新检测显示 url/health/model count；发布 companion 0.7.1。

- 2026-11-27：修复 Docker `--mount` 生成非法裸 `rw` 导致 sandbox 创建必然失败的问题；新增 `buildDockerRunArgs()` 回归测试，并用本机 rootless Docker 完成真实容器挂载/读写验证。sandbox 临时目录改名为 `scratch/`，与用户项目 workspace 分离；Sandboxes 创建表单支持选择 Workspaces 授权目录并显式挂载为 `/workspace`。发布 companion 0.7.2 / core 0.3.1。新增 feishu4dsh 复用与分工建议文档；当前 feishu4dsh 主分支没有扫码 onboarding，扫码能力建议由 feishu4dsh 侧实现。

- 2026-11-27：Companion 更新分层：新增稳定 `she-launcher.mjs`，start.sh/start.ps1 变为薄 bootstrap；新增跨平台 Node companion installer，去掉页面更新对 bash installer 的依赖并开放 Windows 页面内更新；launcher 负责首次安装、75 重启和启动失败回滚；自启动指向稳定 launcher。发布 companion 0.7.3。

- 2026-11-27：修复 GitHub Pages 跨源访问本地 companion 全部 offline：移除读请求中非 CORS-safelisted 的 `cache-control` 请求头，companion CORS 允许头补齐 cache-control/pragma，代理 503 也返回 CORS；PWA 增加全局连接诊断、本地网络权限提示和恢复默认地址按钮。发布 companion 0.7.4。

- 2026-11-27：修复 Chat 任务成功但看不到 OpenCode 最终回复：确认真实 OpenCode 2.3.2 后端会产出 agent.delta + report artifact；PWA 在 task.completed 或 snapshot 发现 succeeded 时刷新 artifacts，未收到实时 text delta 则从 report artifact 回填最终回复，并显示明确诊断。发布 companion 0.7.5。

- 2026-11-27：核查 feishu4dsh R71 `gateway.v1` 薄适配：基础命令/卡片/事件/cursor 契约兼容；SHE 发布 `v0.1.0-packages.2`，`@she/client` 0.1.1 公开 artifacts/downloadArtifact 并增加 feishu4dsh consumer 契约测试。剩余跨仓库需求为 feishu4dsh 接入 artifact 下载与 Feishu sendFile/群聊审批，以及真机闭环。

- 2026-11-27：修复 companion 更新通道被仓库级 GitHub latest 抢占的问题：发布 `v0.1.0-packages.2` 后 `releases/latest/download/companion-release-manifest.json` 变 404，旧 launcher fallback 导致新安装停留在 0.7.2。改为 Pages 独立 `companion-release-manifest.json` + manifest 内绝对 release URL；start.sh/start.ps1 去除版本/tag 硬编码；launcher 优先使用绝对 bundle URL。发布 companion 0.7.6。

- 2026-11-27：修复 companion Pages channel manifest 被 launcher 旧 URL 校验拒绝的问题；发布 companion 0.7.7。start.sh/start.ps1/launcher/PWA 更新检查统一走 Pages `companion-release-manifest.json`，不依赖 GitHub 仓库级 latest。

- 2026-11-27：Sandbox 镜像源下拉：Packages、Sandboxes 新建表单和 Agent Migration 支持 Docker Hub 官方源、DaoCloud、1ms.run、1Panel 镜像代理；Docker Hub 镜像引用按所选源重写，其他 registry 保持原样。SHE gateway.v1 新增 `POST /v1/messages`、`@she/client.message()`、直接命令（`/help`、`/list`、`/status`、`/submit`、`/cancel`、`/stop`）及 `/she` 兼容别名；普通消息以 conversation 路由到独立 topic/session，按 idempotencyKey 去重。新增 SHE 侧实施单与 feishu4dsh 侧复核单；feishu4dsh 需补充 `GatewayMessageResult.taskId/topicId` 到任务 RenderTarget 的关联后联合真机验收。

- 2026-11-27：修复部分网络环境下网页 companion/core 更新报 `fetch failed`：Node fetch 失败时自动回退系统 `curl` 下载 manifest/bundle，并在两者都失败时返回带 URL、fetch cause 和 curl stderr 的可操作错误。launcher/start.sh 分层不变：start 脚本仅首次安装/恢复，日常 companion 更新继续由页面触发、launcher 重启和回滚。

- 2026-11-27：将 companion launcher 对齐 assignment-assistant 的 `稳定 launcher + 启动时检查更新` 模型：launcher 默认每次启动读取 Pages channel manifest，停止状态下用 curl fallback 下载/校验/安装新 companion；`SHE_LAUNCHER_UPDATE_ON_START=0` 可禁用。这样正常重启 `she-companion` / 登录自启动即可发现发布版本，`start.sh` 仅首次安装、恢复或刷新 launcher artifact 时使用。已完成本地真实 launcher 更新测试：0.0.1 → 0.0.2、current 切换、supervised companion health OK。

- 2026-11-27：发布 SHE public packages `v0.1.1-packages.1`：`@she/protocol` 0.1.1（GatewayMessageRequest/Result）、`@she/client` 0.1.2（原生 message()）、`@she/gateway-sdk` 0.1.1；按 feishu4dsh R73 反馈准备类型/依赖收口，并写复核单要求其删除本地 SheGatewayMessageResult 镜像、切到正式 `@she/protocol` 类型与原生 client.message()。
- 2026-11-27：审核 companion bootstrap/更新闭环并修复：`start.sh`/`start.ps1` 增加 curl→Node fetch、Pages launcher 镜像和本地 launcher 降级；页面 companion 更新改为使用 manifest 的绝对 `bundle.url`，修复从 Pages 目录下载 bundle 得到 HTML 404 的问题；PWA build 生成 Pages launcher 镜像；launcher 启动更新默认开启。准备 companion 0.7.8 与 core 0.3.2 构建，补 start.sh fallback 与绝对 URL 回归测试；Vitest 124/124 通过。
- 2026-11-27：补充 companion 0.7.9 发布加固：manifest 的 bundle/launcher 增加 Pages `fallbackUrl`，launcher 和 companion server 在主 GitHub Release 下载失败后自动切换镜像并继续校验 SHA-256；Pages workflow 改为构建完整 companion channel，发布目录同时包含 manifest、launcher 和 bundle。start.sh/start.ps1 优先使用 launcher fallbackUrl，并缩短 GitHub launcher 下载超时。
- 2026-11-27：修正 Pages fallback 发布一致性：Pages workflow 不再重新构建 companion bundle，而是从 GitHub Release 下载与 committed manifest 对应的同一个不可变 bundle，并校验 bundle/launcher SHA-256；解决 0.7.9 中 GitHub Release bundle 与 Pages 重建 bundle 哈希不同导致主源校验失败的问题。准备 companion 0.7.10。
- 2026-11-27：companion 0.7.11 将稳定 channel 的 bundle/launcher 首选源切到 GitHub Pages 同源地址，GitHub Release 作为 checksum-verified fallback；Pages workflow 从 release 下载同一 bundle 以保持哈希一致，避免受限网络下 GitHub 下载长时间超时。
- 2026-11-27：完成宏观架构评审并新增 ADR-0005：明确稳定层是 launcher，companion + bundled PWA 是可更新 app shell，core 是高频业务运行时；start 入口改为本地 launcher 优先，只有首次安装/强制刷新才走网络 bootstrap，并补充回归测试。后续待确认 SHE_HOME 路径统一、app shell 职责收敛、内置 Feishu gateway legacy 化。
- 2026-11-27：执行 App Shell 架构调整：引入统一 SHE_HOME 路径解析（`apps/companion/paths.mjs`），start 脚本和 launcher 本地优先；新增旧布局安全复制迁移 API/CLI；内置 Feishu gateway 标记 legacy；新增 `/api/updates/status` 与 PWA 统一版本/SHE_HOME 管理入口。准备 companion 0.7.12 / core 0.3.3。Vitest 132/132 通过。
- 2026-11-27：companion 0.7.13 / core 0.3.4 将 core 更新也切到 Pages-first channel；core manifest 增加 bundle 主/备 URL，Pages workflow 同步 core bundle fallback；旧 manifest 继续兼容。准备发布。
- 2026-11-27：修复新 SHE_HOME 安装的 bin 选择：新安装固定 `SHE_HOME/bin`，仅 legacy app 使用旧 `~/.local/bin`；生成 `she` 与 `she-companion` 命令。准备 companion 0.7.14。
- 2026-11-27：修复 Sandbox Agent recipe 创建 bug：PWA 曾把“Agent recipe 在容器启动时安装并保持运行”提示文案写入 command，recipe 状态丢失时会作为 Docker 参数发送。新增 sandboxCommandForCreate() 统一解析命令、旧占位文案自动降级为 sleep infinity，并增加回归测试。准备 companion 0.7.15。Vitest 135/135。
