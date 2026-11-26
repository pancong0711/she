# 多 Agent 任务路由设计

> 状态：设计（T5.2）
> 当前实现：单 control-plane worker，固定 OpenCode adapter

## 1. 当前限制

Chat 的 `/she submit` 会把任务写入 topic 队列。SHE 当前只有一个 worker：

```text
topic queue
  → OpenCode worker
  → OpenCode adapter
```

所以目前所有任务实际上都交给同一个 OpenCode 服务，不能按任务选择不同 agent。

## 2. 需要增加的能力

### Task target

Task 增加可选：

```ts
targetAgentId?: string
```

语义：

- 指定后只允许对应 agent worker 领取；
- 未指定时使用默认 route policy；
- 不允许已指定任务被无关 worker 抢走。

### Command

建议支持：

```text
/she submit --agent opencode <request>
/she submit --agent claude-code <request>
```

gateway command 应将 `--agent` 解析成 `targetAgentId`，而不是把字符串直接交给 agent。

### Worker pools

```text
worker(opencode)      claim targetAgentId=opencode or null
worker(claude-code)   claim targetAgentId=claude-code or null
```

Topic 仍保持串行队列；不同 agent 不改变 topic 的串行语义。

### Route policy

```text
explicit target
  > conversation default
  > workspace default
  > global default
```

需要有 capability/health 检查：

- agent 不存在；
- agent unhealthy；
- agent 不支持任务需要的能力；
- workspace/secret 授权不匹配。

### Fanout / delegation

后续支持：

- parent task / child task；
- 最大 delegation depth；
- 最大 fanout；
- 时间/Token/成本预算；
- 循环与自调用防护；
- 子任务产物归属。

## 3. 安全边界

- agent 不接收其他 agent 的凭据；
- sandbox 网络默认 egress/none 策略由 route policy 决定；
- 不同 agent 的 workspace 授权分别检查；
- 子任务不能无限创建；
- 所有 agent 调用都必须经过统一 task 状态机与审计。

## 4. 实施顺序

1. Task.targetAgentId + schema migration；
2. command `--agent`；
3. worker target filter；
4. agent registry/capability health；
5. Chat 下拉选择；
6. 多 worker 进程/容器；
7. fanout/budget/深度策略。

## 5. 当前用户体验

在实现前，Chat 仍只显示当前唯一的 OpenCode worker，不能提供虚假的多 agent 下拉选择。
