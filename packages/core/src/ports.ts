/** Repository and service ports for the control-plane core. */

import type { Artifact, ArtifactId, Task, TaskId, Topic, TopicId } from './domain.js'
import type { TaskLease } from './lease.js'

export interface Clock {
  now(): number
}

export interface IdGenerator {
  next(prefix: string): string
}

export interface TopicRepository {
  get(id: TopicId): Promise<Topic | undefined>
  findActiveByConversation(conversationKey: string): Promise<Topic | undefined>
  listByConversation(conversationKey: string): Promise<readonly Topic[]>
  nextDisplayNo(conversationKey: string): Promise<string>
  save(topic: Topic): Promise<void>
}

export interface TaskRepository {
  get(id: TaskId): Promise<Task | undefined>
  findByIdempotencyKey(key: string): Promise<Task | undefined>
  listByTopic(topicId: TopicId): Promise<readonly Task[]>
  nextSeq(topicId: TopicId): Promise<number>
  save(task: Task): Promise<void>
}

export interface ArtifactRepository {
  get(id: ArtifactId): Promise<Artifact | undefined>
  listByTask(taskId: TaskId): Promise<readonly Artifact[]>
  save(artifact: Artifact): Promise<void>
}

export interface LeaseRepository {
  get(id: string): Promise<TaskLease | undefined>
  findByTaskId(taskId: TaskId): Promise<TaskLease | undefined>
  listExpired(at: number): Promise<readonly TaskLease[]>
  save(lease: TaskLease): Promise<void>
  delete(id: string): Promise<void>
}

/**
 * Ephemeral storage for the exact user request text.
 *
 * Task records intentionally keep only hash/excerpt. The raw request must be
 * stored separately, protected by filesystem/store permissions, and deleted
 * once the executor has consumed it (or by an explicit retention policy).
 */
export interface TaskRequestStore {
  put(taskId: TaskId, request: string): Promise<void>
  get(taskId: TaskId): Promise<string | undefined>
  delete(taskId: TaskId): Promise<void>
}
