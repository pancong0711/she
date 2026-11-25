/** Durable control-plane event model with monotonic cursor semantics. */

import type { TaskPriority, TaskStatus } from './domain.js'

export type DomainAggregateType = 'topic' | 'task' | 'artifact'

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  readonly eventId: string
  readonly aggregateType: DomainAggregateType
  readonly aggregateId: string
  readonly type: TType
  readonly occurredAt: number
  readonly idempotencyKey?: string
  readonly payload: TPayload
}

export interface StoredEvent<TEvent extends DomainEvent = DomainEvent> {
  readonly cursor: string
  readonly sequence: number
  readonly event: TEvent
}

export interface TaskEnqueuedPayload {
  readonly taskId: string
  readonly topicId: string
  readonly seq: number
  readonly priority: TaskPriority
  readonly queuePosition: number
}

export interface TaskStatusChangedPayload {
  readonly taskId: string
  readonly topicId: string
  readonly from: TaskStatus
  readonly to: TaskStatus
  readonly reason?: string
}

export interface TopicCreatedPayload {
  readonly topicId: string
  readonly conversationKey: string
  readonly workspaceKey: string
  readonly displayNo: string
}

export interface ArtifactCreatedPayload {
  readonly artifactId: string
  readonly taskId: string
  readonly kind: 'report' | 'output' | 'diff'
  readonly fileName: string
  readonly bytes: number
}

export type TaskEvent =
  | DomainEvent<'task.enqueued', TaskEnqueuedPayload>
  | DomainEvent<'task.status_changed', TaskStatusChangedPayload>

export type TopicEvent = DomainEvent<'topic.created', TopicCreatedPayload>
export type ArtifactEvent = DomainEvent<'artifact.created', ArtifactCreatedPayload>
export type SheDomainEvent = TaskEvent | TopicEvent | ArtifactEvent

export interface EventPage {
  readonly events: readonly StoredEvent<SheDomainEvent>[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

export interface EventStore {
  append(events: readonly SheDomainEvent[]): Promise<readonly StoredEvent<SheDomainEvent>[]>
  readAfter(cursor: string | null, limit?: number): Promise<EventPage>
}

export function eventCursor(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error(`invalid event sequence: ${sequence}`)
  return `evt:${sequence}`
}

export function parseEventCursor(cursor: string): number {
  const match = /^evt:([1-9][0-9]*)$/.exec(cursor)
  if (match === null) throw new Error(`invalid event cursor: ${cursor}`)
  const sequence = Number(match[1])
  if (!Number.isSafeInteger(sequence)) throw new Error(`invalid event cursor: ${cursor}`)
  return sequence
}
