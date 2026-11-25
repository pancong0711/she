# ADR-0001：稳定 companion + 可更新 core 的分层

> 日期：2026-11-25
> 状态：建议采纳
> 参考经验：`2609-assignment-assistant/docs/22-D71-engine-launcher-two-phase-update.md`
> 关联：PWA、control-plane、broker、发布与更新流程

## 1. 决策

**采纳 assignment-assistant 的分层经验，但由 SHE 自己定义协议和实现，不直接复用 assignment-assistant 的内部 engine/PWA 协议。**

目标结构：

```text
GitHub Pages 静态 PWA
        │ companion-api.v1
        ▼
she-companion（稳定、低频更新）
  ├─ PWA 静态 host / 本地 API proxy
  ├─ 环境检查与安装/更新 job
  ├─ supervisor / staging / pending / rollback
  ├─ core version discovery
  └─ run-core 稳定适配层
        │
        ▼
she-core bundle（高频更新、可替换）
  ├─ control-plane
  ├─ broker
  ├─ gateway/client adapters
  └─ agent/sandbox adapters
```

一句话：

> **companion 是相对稳定的启动/安装/更新/监督层；core 是高频变化、可替换的业务运行时；两者通过明确版本化契约连接。**

## 2. 为什么不直接让 assignment-assistant 给 SHE 定协议

不推荐。

原因：

1. **领域不同**
   - assignment-assistant 的 engine 是作业纸/批阅/学习通自动化；
   - SHE 是 agent control plane，涉及 task/session/sandbox/broker/凭据；
   - 把它的 engine API 抽象成 SHE 的通用协议会产生错误耦合。

2. **生命周期与发布节奏不同**
   - 两个项目独立维护、独立发版；
   - 让一个项目拥有另一个项目的协议会引入跨项目阻塞。

3. **协议所有权必须清晰**
   - SHE 的 `gateway.v1`、`agent.v1`、`sandbox.v1`、`companion-api.v1` 应由 SHE 仓库维护；
   - 其他仓库只能作为消费者。

4. **可借鉴的是模式，不是代码/协议**
   - 稳定 launcher / 可更新 engine；
   - staging→pending→restart→install→health check→rollback；
   - 外部 launcher 不 import engine 内部；
   - PWA 只消费稳定本地面。

如果未来两个产品确实需要共享一个本地面，应抽取**中立的 companion kit / protocol**，而不是让 assignment-assistant 单方面定义 SHE 使用的协议。

## 3. 分层职责

### 3.1 `she-companion`（稳定层）

建议从当前 `apps/pwa/server.mjs` 逐步抽出为独立 app。

职责：

- 只绑定 loopback；
- 提供稳定本地 HTTP/NDJSON API；
- 提供 GitHub Pages PWA 的 CORS 入口；
- 代理 `gateway.v1` / `sandbox.v1` 到 core/broker；
- 环境检查、安装/更新 job、实时日志；
- 管理 core 版本、staging、pending、启动、健康检查与回滚；
- 只调用 core 的稳定入口 `run-core`，不 import core 内部代码。

不应承担：

- 任务/会话/队列状态；
- agent adapter 内部逻辑；
- Docker 操作；
- 飞书 SDK；
- 业务数据持久化。

### 3.2 `she-core` bundle（高频更新层）

包含：

- control-plane；
- broker；
- agent/sandbox adapters；
- 后续 gateway adapters（如果需要本地运行）；
- 业务状态与数据库迁移。

更新特点：

- 可以频繁发布；
- 不负责更新自己；
- 按版本安装到独立目录；
- 通过 `run-core` 被 companion 启动；
- 启动前做版本/capability/health 校验；
- 失败可切回上一版本。

建议目录：

```text
~/.local/share/she/
  core/
    versions/
      0.1.0/
      0.1.1/
    current -> versions/0.1.1
    previous -> versions/0.1.0
  staging/
  pending.json
  releases.json
```

### 3.3 `she-pwa`（静态 UI）

- 部署在 GitHub Pages，独立更新；
- 本地同源模式由 companion 提供静态资源或本地构建；
- 只依赖 `companion-api.v1` 和公开 protocol 类型；
- 不直接依赖 core 内部路径；
- 通过 capability handshake 决定按钮/页面是否可用。

## 4. 协议与版本

### 4.1 `companion-api.v1`

PWA ↔ companion 的稳定面：

```text
GET  /api/health
GET  /api/version
GET  /api/capabilities
POST /api/jobs
GET  /api/jobs/:id
GET  /api/jobs/:id/events
GET  /api/core/status
POST /api/core/update/check
POST /api/core/update/apply
```

要求：

- 版本化和 capability 协商；
- job 白名单，不接受任意命令；
- 所有写操作需要显式确认和 CSRF/PNA 防护；
- 事件流 cursor/幂等；
- 出错返回结构化错误。

### 4.2 `gateway.v1` / `agent.v1` / `sandbox.v1`

保持现有公开协议不变：

- feishu4dsh → `@she/client` / `@she/protocol`；
- PWA 通过 companion 代理访问；
- companion 不解析业务事件，只做代理/转发。

### 4.3 `run-core` 入口契约

core bundle 内提供一个稳定适配入口：

```text
run-core.sh
run-core.cmd
```

契约：

```text
run-core --socket <path> --version <core-version>
```

或者等价的环境变量形式。companion 只调用该入口，不硬编码：

- `node apps/control-plane/dist/main.js`
- `pnpm`
- 具体 CLI 子命令
- 具体端口/文件布局

这样 core 内部重构不需要改 companion。

## 5. 两阶段更新

禁止在 core 运行时直接覆盖其安装目录。

推荐流程：

```text
PWA 点击“检查更新”
  → companion 拉取 release manifest
  → 比较版本/commit/checksum
  → 用户确认
  → 下载到 staging
  → 校验 checksum/signature
  → 写 pending.json
  → 请求旧 core graceful shutdown
  → 旧 core 退出
  → companion 切换 current -> new
  → 启动新 core
  → health/capability check
  → 成功：清理 pending/staging，记录审计
  → 失败：切回 previous，启动旧 core，报告错误
```

规则：

- PWA 不替换 running core 文件；
- PWA 不替换 companion 自己；
- companion 更新需要单独、显式的升级路径；
- 旧版本至少保留一个；
- 所有阶段在 PWA 实时显示；
- 不允许静默失败或半安装状态。

## 6. 为什么要拆

### 6.1 降低更新耦合

- PWA 静态发布不需要重新安装 companion；
- core 高频更新不要求升级 PWA；
- companion 稳定后可以长期不变化。

### 6.2 解决运行时锁与半安装

- 更新时不覆盖运行中的 core；
- 先停止、再切换、再启动；
- 失败可回滚。

### 6.3 版本 skew 可控

- companion-api.v1 稳定；
- core 与 companion 独立版本；
- 通过 capability 协商而不是硬编码版本。

### 6.4 责任边界清晰

- companion 管启动、更新、监督；
- core 管 agent 业务；
- PWA 管可视化；
- protocol 管跨项目/跨进程契约。

## 7. 与当前 SHE 代码的映射

当前：

```text
apps/pwa/server.mjs     # companion 原型
apps/control-plane      # core 的一部分
apps/broker             # core 的一部分
apps/pwa                # 静态 PWA
packages/protocol       # 公开协议
packages/client         # 公开客户端
```

目标：

```text
apps/companion          # 稳定层（从 pwa/server.mjs 抽出）
apps/pwa                # 静态 UI（Pages 可独立部署）
apps/control-plane      # core bundle 内
apps/broker             # core bundle 内
scripts/build-core-bundle.sh
scripts/release-manifest.mjs
```

迁移不要求一次性重写；先抽出 companion 的稳定边界，再补更新机制。

## 8. 实施顺序

### C0：ADR 与契约

- 定稿本 ADR；
- 定义 `companion-api.v1`；
- 定义 `run-core` 入口契约；
- 定义 release manifest schema。

### C1：抽出 companion

- 从 `apps/pwa/server.mjs` 抽出 `apps/companion`；
- 保留现有 `/api/*`、`/v1/*`、`/broker/v1/*` 行为；
- 增加 `/api/version`、`/api/capabilities`、`/api/core/status`；
- 不在 companion 内 import core/broker 内部。

### C2：core bundle 打包

- 生成 `she-core-<version>.tar.gz`；
- 包含 control-plane、broker、适配器、`run-core`；
- 包含 `manifest.json`；
- 提供 checksum。

### C3：版本安装与切换

- versioned dirs；
- current/previous symlink；
- staging/pending；
- 健康检查与回滚。

### C4：PWA 更新 UI

- 检测新版本；
- 展示 release notes/checksum；
- 用户显式确认；
- 实时显示下载/安装/重启/回滚阶段。

## 9. 不做什么

- 不让 SHE 直接复用 assignment-assistant 的 engine CLI/协议；
- 不把 assignment-assistant 的代码变成 SHE 依赖；
- 不让 PWA 在运行中改 companion 自身；
- 不让 companion import core 业务模块；
- 不在 core 运行时覆盖 core 文件；
- 不把系统级安装做成无确认静默执行。

## 10. 结论

建议：

1. **采纳分层经验**；
2. **由 SHE 自己定义 companion-api.v1 / run-core / release manifest**；
3. **assignment-assistant 只作为设计参考，不为其开发 SHE 协议**；
4. 若未来出现跨产品复用价值，再抽取中立的 `companion-kit`；
5. 当前先把 `apps/pwa/server.mjs` 演进为独立 `apps/companion`，再实现 core bundle 两阶段更新。
