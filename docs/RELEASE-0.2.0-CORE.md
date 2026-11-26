# SHE core 0.2.0 发布说明

> Release：`v0.2.0-core.1`
> 日期：2026-11-26

## 新增

- Task report artifact：
  - 成功任务自动生成 Markdown 报告；
  - 写入 workspace `.she/reports/<taskId>.md`；
  - artifact repository 与 artifact.created 事件；
  - task.reportArtifactId；
- control-plane artifact API：
  - `GET /v1/artifacts?taskId=...`
  - `GET /v1/artifacts/:id/download`
- core bundle 版本与 root package 解耦，使用 `apps/control-plane/package.json`；
- run-core 向 control-plane/broker 注入 bundle `SHE_VERSION=0.2.0`。

## 验证

- core bundle 启动；
- control-plane `/v1/health` version 0.2.0；
- artifact list API；
- report persistence 单测；
- download API 单测；
- 无 Docker 启动仍为 control ok + broker degraded。
