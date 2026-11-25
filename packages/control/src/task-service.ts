/** Task application service: the only writer of task/topic state transitions. */

import { createHash } from 'node:crypto'
import type { AttachmentRef } from '@she/protocol'
import {
  canTransitionTask,
  transitionTask,
  type ArtifactRepository,
  type Clock,
  type DomainError,
  type EventStore,
  type IdGenerator,
  type StoredEvent,
  type Task,
  type TaskPriority,
  type TaskRepository,
  type TaskRequestStore,
  type TaskRisk,
  type TaskStatus,
  type TaskTransitionPatch,
  type Topic,
  type TopicRepository,
} from '@she/core'

export type TaskServiceErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'lease_expired'
  | 'invalid_transition'

export class TaskServiceError extends Error {
  readonly code: TaskServiceErrorCode

  constructor(code: TaskServiceErrorCode, message: string) {
    super(message)
    this.name = 'TaskServiceError'
    this.code = code
  }
}

export interface SubmitTaskInput {
  readonly conversationKey: string
  readonly workspaceKey: string
  readonly request: string
  readonly title?: string
  readonly attachments?: readonly AttachmentRef[]
  readonly priority?: TaskPriority
  readonly risk?: TaskRisk
  readonly idempotencyKey?: string
}

export interface SubmitTaskResult {
  readonly topic: Topic
  readonly task: Task
  readonly events: readonly StoredEvent[]
  readonly deduplicated: boolean
}

export interface CancelTaskResult {
  readonly topic: Topic | undefined
  readonly task: Task
  readonly event: StoredEvent | undefined
}

export interface TaskServiceDeps {
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly topics: TopicRepository
  readonly tasks: TaskRepository
  readonly artifacts: ArtifactRepository
  readonly requests: TaskRequestStore
  readonly events: EventStore
}

function excerptTwenty(raw: string): string {
  return Array.from(raw.trim()).slice(0, 20).join('')
}

function hashRequest(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  async submit(input: SubmitTaskInput): Promise<SubmitTaskResult> {
    const request = input.request
    if (request.trim() === '') throw new TaskServiceError('invalid_request', 'task request must not be empty')
    const conversationKey = input.conversationKey.trim()
    const workspaceKey = input.workspaceKey.trim()
    if (conversationKey === '') {
      throw new TaskServiceError('invalid_request', 'conversationKey must not be empty')
    }
    if (workspaceKey === '') throw new TaskServiceError('invalid_request', 'workspaceKey must not be empty')

    const idempotencyKey = input.idempotencyKey?.trim() || undefined
    if (idempotencyKey !== undefined) {
      const existing = await this.deps.tasks.findByIdempotencyKey(idempotencyKey)
      if (existing !== undefined) {
        const existingTopic = await this.deps.topics.get(existing.topicId)
        if (existingTopic === undefined) {
          throw new TaskServiceError('conflict', `topic ${existing.topicId} is missing for task ${existing.id}`)
        }
        return { topic: existingTopic, task: existing, events: [], deduplicated: true }
      }
    }

    const now = this.deps.clock.now()
    let topic = await this.deps.topics.findActiveByConversation(conversationKey)
    const events: Parameters<EventStore['append']>[0][number][] = []
    let topicCreated = false
    if (topic === undefined) {
      const displayNo = await this.deps.topics.nextDisplayNo(conversationKey)
      topic = {
        id: this.deps.ids.next('topic'),
        conversationKey,
        displayNo,
        title: input.title?.trim() || excerptTwenty(request),
        workspaceKey,
        status: 'active',
        activeTaskId: null,
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now,
      }
      await this.deps.topics.save(topic)
      topicCreated = true
      events.push({
        eventId: this.deps.ids.next('event'),
        aggregateType: 'topic',
        aggregateId: topic.id,
        type: 'topic.created',
        occurredAt: now,
        payload: {
          topicId: topic.id,
          conversationKey,
          workspaceKey,
          displayNo,
        },
      })
    }

    const seq = await this.deps.tasks.nextSeq(topic.id)
    const existingTasks = await this.deps.tasks.listByTopic(topic.id)
    const queuePosition = existingTasks.filter(task => task.status === 'queued').length + 1
    const task: Task = {
      id: this.deps.ids.next('task'),
      topicId: topic.id,
      seq,
      status: 'queued',
      priority: input.priority ?? 'interactive',
      risk: input.risk ?? 'workspace-write',
      requestHash: hashRequest(request),
      requestExcerpt: excerptTwenty(request),
      idempotencyKey: idempotencyKey ?? null,
      attachments: input.attachments ?? [],
      agentSessionId: null,
      sandboxName: null,
      reportArtifactId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    }
    await this.deps.tasks.save(task)
    await this.deps.requests.put(task.id, request)
    events.push({
      eventId: this.deps.ids.next('event'),
      aggregateType: 'task',
      aggregateId: task.id,
      type: 'task.enqueued',
      occurredAt: now,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      payload: {
        taskId: task.id,
        topicId: topic.id,
        seq,
        priority: task.priority,
        queuePosition,
      },
    })
    const stored = await this.deps.events.append(events)
    return {
      topic: topicCreated ? topic : topic,
      task,
      events: stored,
      deduplicated: false,
    }
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    return this.deps.tasks.get(taskId)
  }

  async getTopic(topicId: string): Promise<Topic | undefined> {
    return this.deps.topics.get(topicId)
  }

  async listTasks(conversationKey: string): Promise<readonly Task[]> {
    const topics = await this.deps.topics.listByConversation(conversationKey)
    const result: Task[] = []
    for (const topic of topics) result.push(...(await this.deps.tasks.listByTopic(topic.id)))
    return result
  }

  async cancelTask(taskId: string, reason?: string): Promise<CancelTaskResult> {
    const task = await this.deps.tasks.get(taskId)
    if (task === undefined) throw new TaskServiceError('not_found', `task not found: ${taskId}`)
    if (!canTransitionTask(task.status, 'cancelled')) {
      throw new TaskServiceError('invalid_transition', `cannot cancel task in status ${task.status}`)
    }
    return this.transitionTask(task, 'cancelled', reason)
  }

  async transitionTask(
    taskOrId: Task | string,
    to: TaskStatus,
    reason?: string,
    patch: TaskTransitionPatch = {},
  ): Promise<CancelTaskResult> {
    const task = typeof taskOrId === 'string' ? await this.deps.tasks.get(taskOrId) : taskOrId
    if (task === undefined) throw new TaskServiceError('not_found', `task not found: ${taskOrId}`)
    if (!canTransitionTask(task.status, to)) {
      throw new TaskServiceError('invalid_transition', `invalid task transition: ${task.status} -> ${to}`)
    }
    const now = this.deps.clock.now()
    const next = transitionTask(task, to, now, patch)
    await this.deps.tasks.save(next)
    const error: DomainError | null = next.error
    const event = {
      eventId: this.deps.ids.next('event'),
      aggregateType: 'task' as const,
      aggregateId: next.id,
      type: 'task.status_changed' as const,
      occurredAt: now,
      payload: {
        taskId: next.id,
        topicId: next.topicId,
        from: task.status,
        to,
        ...(reason === undefined ? {} : { reason }),
        ...(error === null ? {} : { error }),
      },
    }
    const stored = await this.deps.events.append([event])
    const topic = await this.deps.topics.get(next.topicId)
    let updatedTopic = topic
    if (topic !== undefined && topic.activeTaskId === next.id && (to === 'succeeded' || to === 'failed' || to === 'interrupted' || to === 'needs_attention' || to === 'cancelled')) {
      updatedTopic = { ...topic, activeTaskId: null, updatedAt: now, lastActiveAt: now }
      await this.deps.topics.save(updatedTopic)
    }
    return { topic: updatedTopic, task: next, event: stored[0] }
  }
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now()
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private value = 0

  next(prefix: string): string {
    this.value += 1
    return `${prefix}-${String(this.value).padStart(6, '0')}`
  }
}
