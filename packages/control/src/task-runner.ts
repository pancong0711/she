/** End-to-end task execution: queue claim -> agent adapter -> terminal state. */

import type { AgentAdapter } from '@she/agent-sdk'
import type {
  AgentEventEnvelope,
  AgentModelRef,
  AgentSessionRef,
  AgentTurnEndEvent,
} from '@she/protocol'
import {
  TASK_TERMINAL_STATUSES,
  type DomainError,
  type Task,
  type TaskStatus,
  type TaskTransitionPatch,
  type Topic,
} from '@she/core'
import { TaskService, type TaskServiceDeps } from './task-service.js'
import { TopicQueue, type TopicQueueDeps, type TopicQueueOptions } from './topic-queue.js'

export interface TaskRunnerDeps extends TopicQueueDeps {
  readonly agent: AgentAdapter
}

export interface RunNextInput {
  readonly topicId: string
  readonly ownerId: string
  readonly leaseTtlMs?: number
  readonly model?: AgentModelRef
}

export interface RunNextResult {
  readonly task: Task
  readonly topic: Topic
  readonly agentSession: AgentSessionRef | undefined
  readonly agentEvents: readonly AgentEventEnvelope[]
  readonly finalStatus: Task['status']
}

function toDomainError(error: unknown, code = 'agent_error'): DomainError {
  if (error instanceof Error) {
    return { code, message: error.message, retryable: true }
  }
  return { code, message: String(error), retryable: true }
}

function sheErrorToDomainError(error: { readonly code: string; readonly message: string; readonly retryable: boolean }): DomainError {
  return { code: error.code, message: error.message, retryable: error.retryable }
}

/**
 * Execute one queued task end to end against an agent adapter.
 *
 * Contract:
 * - `AgentAdapter.prompt()` must end with a `turn-end` event;
 * - errors are converted to a terminal `failed` task, not thrown to the caller;
 * - leases are heartbeat while the prompt stream is active and released once
 *   the task becomes terminal;
 * - the raw request spool is deleted after terminal settlement.
 */
export class TaskRunner {
  private readonly taskService: TaskService
  private readonly queue: TopicQueue

  constructor(
    private readonly deps: TaskRunnerDeps,
    options: TopicQueueOptions = {},
  ) {
    this.taskService = new TaskService(deps)
    this.queue = new TopicQueue(deps, options)
  }

  /**
   * Claim and execute the next task for a topic.
   * Returns `undefined` when there is no claimable task.
   */
  async runNext(input: RunNextInput): Promise<RunNextResult | undefined> {
    const claimed = await this.queue.claimNext(input)
    if (claimed === undefined) return undefined

    let agentSession: AgentSessionRef | undefined
    let agentEvents: readonly AgentEventEnvelope[] = []
    let final: { readonly task: Task; readonly topic: Topic } | undefined
    let heartbeatFailure: DomainError | undefined

    try {
      const requestText = await this.deps.requests.get(claimed.task.id)
      if (requestText === undefined) {
        final = await this.settleFailure(
          claimed.task,
          { code: 'request_missing', message: 'raw task request is no longer available', retryable: false },
          'request_missing',
        )
        return {
          task: final.task,
          topic: final.topic,
          agentSession,
          agentEvents,
          finalStatus: final.task.status,
        }
      }

      agentSession = await this.deps.agent.createSession({
        adapterId: this.deps.agent.descriptor.adapterId,
        sessionKey: claimed.topic.id,
        workspace: { key: claimed.topic.workspaceKey },
        ...(input.model === undefined ? {} : { model: input.model }),
        metadata: { taskId: claimed.task.id, topicId: claimed.topic.id },
      })

      const submitted = await this.taskService.transitionTask(
        claimed.task,
        'submitted',
        'agent_session_created',
        { agentSessionId: agentSession.sessionId },
      )
      const running = await this.taskService.transitionTask(
        submitted.task,
        'running',
        'agent_prompt_started',
      )

      const heartbeatInterval = Math.max(10, Math.floor(claimed.lease.ttlMs / 2))
      const timer = setInterval(() => {
        void this.queue.heartbeat(claimed.lease.id, input.ownerId).catch(error => {
          if (heartbeatFailure === undefined) {
            heartbeatFailure = toDomainError(error, 'lease_heartbeat_failed')
          }
        })
      }, heartbeatInterval)
      timer.unref()

      try {
        const outcome = await this.consumePrompt(running.task, agentSession, requestText)
        agentEvents = outcome.events
        if (heartbeatFailure !== undefined) {
          final = await this.settleFailure(running.task, heartbeatFailure, 'lease_heartbeat_failed')
        } else if (outcome.failure !== undefined) {
          final = await this.settleFailure(running.task, outcome.failure, 'agent_execution_failed')
        } else if (outcome.turnEnd?.reason === 'completed') {
          final = await this.transitionRequired(running.task, 'succeeded', 'agent_turn_completed')
        } else if (outcome.turnEnd?.reason === 'cancelled') {
          final = await this.transitionRequired(running.task, 'interrupted', 'agent_turn_cancelled')
        } else if (outcome.turnEnd?.reason === 'max-tokens') {
          final = await this.settleFailure(
            running.task,
            { code: 'agent_max_tokens', message: 'agent stopped at the token limit', retryable: true },
            'agent_max_tokens',
          )
        } else if (outcome.turnEnd?.reason === 'error') {
          final = await this.settleFailure(
            running.task,
            { code: 'agent_turn_error', message: outcome.turnEnd.detail ?? 'agent turn failed', retryable: true },
            'agent_turn_error',
          )
        } else {
          final = await this.settleFailure(
            running.task,
            { code: 'turn_end_missing', message: 'agent prompt stream ended without turn-end', retryable: true },
            'turn_end_missing',
          )
        }
      } finally {
        clearInterval(timer)
      }
    } catch (error) {
      const current = await this.deps.tasks.get(claimed.task.id)
      if (current !== undefined && !TASK_TERMINAL_STATUSES.has(current.status)) {
        final = await this.settleFailure(current, toDomainError(error), 'agent_execution_failed')
      } else if (current !== undefined) {
        const topic = await this.deps.topics.get(current.topicId)
        if (topic !== undefined) final = { task: current, topic }
      }
    } finally {
      try {
        await this.queue.releaseLease(claimed.lease.id, input.ownerId)
      } catch {
        // Recovery will reclaim an orphaned lease if the owner was lost.
      }
      if (final !== undefined && TASK_TERMINAL_STATUSES.has(final.task.status)) {
        await this.deps.requests.delete(final.task.id).catch(() => undefined)
      }
    }

    if (final === undefined) throw new Error(`task ${claimed.task.id} did not reach a terminal state`)
    return {
      task: final.task,
      topic: final.topic,
      agentSession,
      agentEvents,
      finalStatus: final.task.status,
    }
  }

  private async consumePrompt(
    task: Task,
    session: AgentSessionRef,
    requestText: string,
  ): Promise<{
    readonly events: readonly AgentEventEnvelope[]
    readonly failure: DomainError | undefined
    readonly turnEnd: AgentTurnEndEvent | undefined
  }> {
    const events: AgentEventEnvelope[] = []
    let failure: DomainError | undefined
    let turnEnd: AgentTurnEndEvent | undefined
    try {
      for await (const envelope of this.deps.agent.prompt({
        promptId: task.id,
        sessionId: session.sessionId,
        text: requestText,
        idempotencyKey: task.id,
      })) {
        events.push(envelope)
        if (envelope.event.kind === 'error') {
          failure = sheErrorToDomainError(envelope.event.error)
          break
        }
        if (envelope.event.kind === 'turn-end') {
          turnEnd = envelope.event
          break
        }
      }
    } catch (error) {
      failure = toDomainError(error)
    }
    return { events, failure, turnEnd }
  }

  private async settleFailure(
    task: Task,
    error: DomainError,
    reason: string,
  ): Promise<{ readonly task: Task; readonly topic: Topic }> {
    return this.transitionRequired(task, 'failed', reason, { error })
  }

  private async transitionRequired(
    task: Task,
    to: TaskStatus,
    reason?: string,
    patch: TaskTransitionPatch = {},
  ): Promise<{ readonly task: Task; readonly topic: Topic }> {
    const result = await this.taskService.transitionTask(task, to, reason, patch)
    const topic = result.topic ?? await this.deps.topics.get(result.task.topicId)
    if (topic === undefined) throw new Error(`topic ${result.task.topicId} is missing for task ${result.task.id}`)
    return { task: result.task, topic }
  }
}
