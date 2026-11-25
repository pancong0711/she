/** Minimal OpenCode-backed task worker for the local control plane. */

import type { AgentModelRef, GatewayWorkerHealth } from '@she/protocol'
import { TaskRunner, type TopicQueueDeps } from '@she/control'
import type { OpenCodeAgentAdapter } from '@she/agent-opencode'

export interface TaskWorkerOptions {
  readonly deps: TopicQueueDeps
  readonly agent: OpenCodeAgentAdapter
  readonly workspacePath: string
  readonly pollIntervalMs: number
  readonly leaseTtlMs?: number
  readonly model?: AgentModelRef
}

export class TaskWorker {
  private readonly runner: TaskRunner
  private readonly controller = new AbortController()
  private state: GatewayWorkerHealth['state'] = 'idle'
  private lastTaskId: string | undefined
  private lastError: string | undefined
  private updatedAt = Date.now()
  private loopPromise: Promise<void> | undefined

  constructor(private readonly options: TaskWorkerOptions) {
    this.runner = new TaskRunner(
      { ...options.deps, agent: options.agent },
      options.leaseTtlMs === undefined ? {} : { defaultLeaseTtlMs: options.leaseTtlMs },
    )
  }

  start(): void {
    if (this.loopPromise !== undefined) return
    this.state = 'idle'
    this.updatedAt = Date.now()
    this.loopPromise = this.loop()
  }

  async stop(): Promise<void> {
    this.controller.abort()
    await this.loopPromise?.catch(() => undefined)
    this.loopPromise = undefined
    this.state = 'stopped'
    this.updatedAt = Date.now()
  }

  status(): GatewayWorkerHealth {
    return {
      enabled: true,
      state: this.state,
      ...(this.lastTaskId === undefined ? {} : { lastTaskId: this.lastTaskId }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      updatedAt: this.updatedAt,
    }
  }

  private async loop(): Promise<void> {
    while (!this.controller.signal.aborted) {
      let worked = false
      try {
        const topics = await this.options.deps.topics.listAll()
        for (const topic of topics) {
          if (this.controller.signal.aborted) break
          if (topic.status !== 'active') continue
          const result = await this.runner.runNext({
            topicId: topic.id,
            ownerId: 'control-plane-worker',
            workspacePath: this.options.workspacePath,
            ...(this.options.model === undefined ? {} : { model: this.options.model }),
          })
          if (result !== undefined) {
            worked = true
            this.lastTaskId = result.task.id
            this.lastError = result.task.error?.message
            this.updatedAt = Date.now()
            break
          }
        }
      } catch (error) {
        this.state = 'error'
        this.lastError = error instanceof Error ? error.message : String(error)
        this.updatedAt = Date.now()
      }
      if (!worked) {
        this.state = 'idle'
        this.updatedAt = Date.now()
        await new Promise<void>(resolvePromise => {
          const timer = setTimeout(resolvePromise, this.options.pollIntervalMs)
          timer.unref()
        })
      } else {
        this.state = 'running'
      }
    }
  }
}
