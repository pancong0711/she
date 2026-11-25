/** Core SHE domain entities. These types are platform and transport agnostic. */

import type { AttachmentRef } from '@she/protocol'

export type TopicId = string
export type TaskId = string
export type AttemptId = string
export type ArtifactId = string

export type TopicStatus = 'active' | 'paused' | 'archived'

export type TaskStatus =
  | 'queued'
  | 'dispatching'
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'interrupted'
  | 'needs_attention'
  | 'cancelled'

export type TaskPriority = 'interactive' | 'background' | 'batch'
export type TaskRisk = 'read-only' | 'workspace-write' | 'network'

export interface DomainError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly details?: Readonly<Record<string, unknown>>
}

export interface Topic {
  readonly id: TopicId
  /** Opaque conversation identity supplied by a gateway adapter. */
  readonly conversationKey: string
  /** User-visible per-conversation label; null while archived. */
  readonly displayNo: string | null
  readonly title: string
  readonly workspaceKey: string
  readonly status: TopicStatus
  readonly activeTaskId: TaskId | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastActiveAt: number
}

export interface Task {
  readonly id: TaskId
  readonly topicId: TopicId
  /** Monotonic sequence inside the topic; display form is `<topic>.<seq>`. */
  readonly seq: number
  readonly status: TaskStatus
  readonly priority: TaskPriority
  readonly risk: TaskRisk
  readonly requestHash: string
  readonly requestExcerpt: string
  readonly idempotencyKey: string | null
  readonly attachments: readonly AttachmentRef[]
  readonly agentSessionId: string | null
  readonly sandboxName: string | null
  readonly reportArtifactId: ArtifactId | null
  readonly error: DomainError | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly startedAt: number | null
  readonly finishedAt: number | null
}

export type AttemptStatus = 'running' | 'succeeded' | 'failed' | 'interrupted'

export interface TaskAttempt {
  readonly id: AttemptId
  readonly taskId: TaskId
  readonly attemptNo: number
  readonly status: AttemptStatus
  readonly agentSessionId: string
  readonly sandboxName: string | null
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly error: DomainError | null
}

export type ArtifactKind = 'report' | 'output' | 'diff'

export interface Artifact {
  readonly id: ArtifactId
  readonly taskId: TaskId
  readonly kind: ArtifactKind
  readonly fileName: string
  readonly bytes: number
  readonly sha256: string
  /** Opaque storage identifier; never a caller-chosen host path. */
  readonly storageRef: string
  readonly createdAt: number
}

export type AgentInstanceState = 'starting' | 'ready' | 'busy' | 'idle' | 'failed' | 'closed'

export interface AgentInstance {
  readonly id: string
  readonly adapterId: string
  readonly sessionId: string | null
  readonly workspaceKey: string
  readonly state: AgentInstanceState
  readonly createdAt: number
  readonly updatedAt: number
}

export type SandboxInstanceState = 'pending' | 'running' | 'stopped' | 'failed' | 'destroyed'

export interface SandboxInstance {
  readonly name: string
  readonly role: 'standalone' | 'main' | 'worker' | 'observer' | 'utility'
  readonly agentId: string
  readonly state: SandboxInstanceState
  readonly createdAt: number
  readonly updatedAt: number
}
