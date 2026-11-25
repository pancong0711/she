/** Pure domain state machines. Only these helpers should mutate task/topic state. */

import type { ArtifactId, Task, TaskId, TaskStatus, Topic, TopicStatus } from './domain.js'

export const TASK_TERMINAL_STATUSES = new Set<TaskStatus>([
  'succeeded',
  'failed',
  'interrupted',
  'needs_attention',
  'cancelled',
])

export const TOPIC_TERMINAL_STATUSES = new Set<TopicStatus>(['archived'])

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ['dispatching', 'cancelled'],
  dispatching: ['submitted', 'failed', 'needs_attention', 'cancelled'],
  submitted: ['running', 'failed', 'interrupted', 'cancelled'],
  running: ['succeeded', 'failed', 'interrupted', 'needs_attention', 'cancelled'],
  succeeded: [],
  failed: [],
  interrupted: [],
  needs_attention: [],
  cancelled: [],
}

export const TOPIC_TRANSITIONS: Readonly<Record<TopicStatus, readonly TopicStatus[]>> = {
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
  archived: ['active'],
}

export class InvalidTaskTransitionError extends Error {
  readonly from: TaskStatus
  readonly to: TaskStatus

  constructor(from: TaskStatus, to: TaskStatus) {
    super(`invalid task transition: ${from} -> ${to}`)
    this.name = 'InvalidTaskTransitionError'
    this.from = from
    this.to = to
  }
}

export class InvalidTopicTransitionError extends Error {
  readonly from: TopicStatus
  readonly to: TopicStatus

  constructor(from: TopicStatus, to: TopicStatus) {
    super(`invalid topic transition: ${from} -> ${to}`)
    this.name = 'InvalidTopicTransitionError'
    this.from = from
    this.to = to
  }
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

export function canTransitionTopic(from: TopicStatus, to: TopicStatus): boolean {
  return TOPIC_TRANSITIONS[from].includes(to)
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) throw new InvalidTaskTransitionError(from, to)
}

export function assertTopicTransition(from: TopicStatus, to: TopicStatus): void {
  if (!canTransitionTopic(from, to)) throw new InvalidTopicTransitionError(from, to)
}

export interface TaskTransitionPatch {
  readonly agentSessionId?: string | null
  readonly sandboxName?: string | null
  readonly reportArtifactId?: ArtifactId | null
  readonly error?: Task['error']
  readonly startedAt?: number | null
  readonly finishedAt?: number | null
}

export function transitionTask(task: Task, to: TaskStatus, at: number, patch: TaskTransitionPatch = {}): Task {
  assertTaskTransition(task.status, to)
  const startedAt =
    patch.startedAt !== undefined
      ? patch.startedAt
      : task.startedAt === null && (to === 'submitted' || to === 'running')
        ? at
        : task.startedAt
  const finishedAt =
    patch.finishedAt !== undefined
      ? patch.finishedAt
      : TASK_TERMINAL_STATUSES.has(to)
        ? at
        : task.finishedAt

  return {
    ...task,
    status: to,
    agentSessionId: patch.agentSessionId !== undefined ? patch.agentSessionId : task.agentSessionId,
    sandboxName: patch.sandboxName !== undefined ? patch.sandboxName : task.sandboxName,
    reportArtifactId:
      patch.reportArtifactId !== undefined ? patch.reportArtifactId : task.reportArtifactId,
    error: patch.error !== undefined ? patch.error : task.error,
    startedAt,
    finishedAt,
    updatedAt: at,
  }
}

export interface TopicTransitionPatch {
  readonly displayNo?: string | null
  readonly activeTaskId?: TaskId | null
  readonly title?: string
}

export function transitionTopic(topic: Topic, to: TopicStatus, at: number, patch: TopicTransitionPatch = {}): Topic {
  assertTopicTransition(topic.status, to)
  return {
    ...topic,
    status: to,
    displayNo: patch.displayNo !== undefined ? patch.displayNo : topic.displayNo,
    activeTaskId: patch.activeTaskId !== undefined ? patch.activeTaskId : topic.activeTaskId,
    title: patch.title !== undefined ? patch.title : topic.title,
    updatedAt: at,
    lastActiveAt: at,
  }
}
