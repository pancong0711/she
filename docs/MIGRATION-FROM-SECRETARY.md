# 从 feishu4dsh secretary 迁移到独立 SHE

> 日期：2026-11-25
> 状态：迁移策略 v1；代码级状态导入工具尚未实现
> 关联：`docs/M4-FEISHU4DSH-THIN-ADAPTER.md`

## 1. 原则

- 不静默迁移；
- 不一次性删除旧路径；
- 先双轨，后切换，再删除；
- 迁移前备份；
- 失败可回滚；
- 旧数据不能在没有说明的情况下丢失。

## 2. 迁移对象

### 2.1 配置

旧 feishu4dsh 配置前缀：

```text
secretaryEnabled
secretaryAutoRestore
secretaryBootstrapFile
secretarySandboxRoot
secretarySandboxUser
secretarySandboxBuilderUser
secretarySandboxDescriptor
secretarySandboxOpencodeUrl
secretarySandboxPasswordFile
secretaryRoot
secretaryOpencodeUrl
secretaryOpencodeUsername
secretaryOpencodePassword
secretaryOpencodePasswordFile
secretaryModelProviderID
secretaryModelID
secretaryModelVariant
secretaryPollIntervalMs
secretaryLeaseMs
secretaryMaxTopicsPerChat
secretaryMaxQueuedTasks
secretaryMaxConcurrent
secretaryRequireReport
secretaryMaxReportBytes
```

新 SHE 对应方向：

```text
she.enabled
she.socket
she.tokenFile
she.statePath
she.agent.opencode.baseUrl
she.agent.opencode.username
she.agent.opencode.credentialFile
she.agent.model.providerId
she.agent.model.modelId
she.agent.model.variant
she.queue.maxConcurrent
she.queue.defaultLeaseTtlMs
she.report.required
she.report.maxBytes
```

具体 key 名称以最终 `docs/CONFIGURATION.md` 为准；迁移工具应提供显式映射表，而不是猜字段。

### 2.2 状态

旧路径：

```text
~/.local/state/feishu4dsh/she-bootstrap.json
~/.local/share/feishu4dsh/broker/
~/.local/share/feishu4dsh/sandboxes/
<project>/.feishu4dsh/secretary/
```

新路径：

```text
~/.local/state/she/
~/.local/share/she/
~/.config/she/
```

注意：

- 旧 SQLite schema 与新 schema 不同；
- 旧 Topic/Task/attempt/event 语义需要映射；
- 旧 OpenCode session/worktree 引用不能直接假定仍有效；
- 旧 sandbox descriptor 需要重新登记/校验；
- 迁移工具必须生成迁移报告和失败清单。

## 3. 推荐迁移阶梯

### 阶段 1：只读双轨

- 旧 `src/secretary/` 保留；
- 新 feishu4dsh 集成默认关闭；
- 新 SHE control-plane 独立启动；
- 只对少量只读命令切换到新路径；
- 出现差异时可立即回切。

### 阶段 2：新任务走新 SHE

- 新 `/she submit` 创建 SHE task；
- 旧任务只读保留；
- 旧 secretary 不再创建新任务；
- 对旧任务提供查看/结束/导出；
- 记录双轨对照。

### 阶段 3：一次性数据迁移（可选）

只有在需要保留历史 Topic/Task 时实施：

1. 停旧 secretary 写入；
2. 备份旧 DB 和 bootstrap；
3. 运行 `she migrate secretary --dry-run`；
4. 审查映射报告；
5. `--apply` 导入；
6. 校验 task 数、状态和报告引用；
7. 记录迁移时间/版本。

当前该 CLI 尚未实现，不能宣称历史任务自动迁移可用。

### 阶段 4：删除旧 SHE

前置：

- 新路径读/写/审批/文件闭环全绿；
- 真机验收；
- 至少一个发布周期双轨；
- 迁移/不迁移决定已写入发布说明；
- 回滚包可用。

## 4. 配置迁移建议

首版可提供：

```text
she doctor legacy
she migrate config --from feishu4dsh --dry-run
she migrate config --from feishu4dsh --apply
```

规则：

- 不覆盖已有新配置；
- 默认不复制明文密码；
- 密码文件路径迁移时必须重新确认权限；
- 迁移后生成 diff；
- 旧配置保留只读备份。

## 5. 不迁移策略

如果决定不迁移历史任务，必须明确：

- 旧任务不做自动导入；
- 旧 DB 保留只读备份；
- `/she` 旧路径删除前给出提示；
- 新 SHE 从空状态开始；
- 文档和发布说明写明限制。

## 6. 回滚

回滚条件：

- 新控制面不可用；
- 飞书渲染/审批退化；
- 任务状态不一致；
- 文件/产物丢失；
- 真机阻塞。

回滚步骤：

1. 关闭 feishu4dsh 的 `she.enabled`；
2. 恢复旧 `secretaryEnabled` 配置；
3. 重启 feishu4dsh；
4. 保留新 SHE 状态不动，供分析；
5. 不改旧 DB；
6. 记录 incident 和差异。

## 7. 验收

- [ ] 双轨开关明确；
- [ ] 旧配置有映射表或明确不迁移；
- [ ] 旧状态有备份；
- [ ] 迁移工具支持 dry-run；
- [ ] 失败清单可读；
- [ ] 回滚步骤经过演练；
- [ ] 旧 `/she` 不静默消失。
