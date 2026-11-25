/** Serial per-topic dispatch queue with ownership leases and expiry recovery. */

import {
  isLeaseExpired,
  type Clock,
  type IdGenerator,
  type LeaseRepository,
  type Task,
  type TaskLease,
  type TaskRepository,
  type Topic,
  type TopicId,
  type TopicRepository,
} from '@she/core'
import { TaskService, TaskServiceError, type TaskServiceDeps } from './task-service.js'

const ACTIVE_TASK_STATUSES = new Set<Task['status']>(['dispatching', 'submitted', 'running'])

export interface TopicQueueOptions {
  /** Default lease duration for claims and heartbeats. Defaults to 5 minutes. */
  readonly defaultLeaseTtlMs?: number
}

export interface ClaimNextInput {
  readonly topicId: TopicId
  readonly ownerId: string
  /** Optional override of the queue's default lease TTL. */
  readonly leaseTtlMs?: number
}

export interface ClaimNextResult {
  readonly task: Task
  readonly topic: Topic
  readonly lease: TaskLease
}

export interface RecoveredLease {
  readonly lease: TaskLease
  readonly task: Task | undefined
  readonly topic: Topic | undefined
  readonly reason: 'lease_expired' | 'task_missing' | 'task_not_active'
}

export interface TopicQueueDeps extends TaskServiceDeps {
  readonly leases: LeaseRepository
}

/**
 * Serial dispatch queue for one topic at a time.
 *
 * The queue guarantees, within one process:
 * - `claimNext()` returns at most one task per topic at a time;
 * - only the lease owner may heartbeat;
 * - expired leases are converted to `needs_attention` tasks by explicit
 *   recovery, never silently re-dispatched.
 *
 * Cross-process serialization and crash-safe lease ownership are completed by
 * the SQLite transaction layer in T1.5. The in-process mutex below prevents
 * the common re-entrant claim race during unit tests and single-process use.
 */
export class TopicQueue {
  private readonly defaultLeaseTtlMs: number
  private readonly taskService: TaskService
  private readonly tails = new Map<string, Promise<void>>()

  constructor(private readonly deps: TopicQueueDeps, options: TopicQueueOptions = {}) {
    this.defaultLeaseTtlMs = options.defaultLeaseTtlMs ?? 5 * 60_000
    if (!Number.isFinite(this.defaultLeaseTtlMs) || this.defaultLeaseTtlMs < 1) {
      throw new TaskServiceError('invalid_request', 'defaultLeaseTtlMs must be positive')
    }
    this.taskService = new TaskService(deps)
  }

  /**
   * Claim the next queued task for a topic.
   *
   * Returns `undefined` when:
   * - the topic does not exist or is not active;
   * - another task is already dispatching/submitted/running;
   * - the queue is empty.
   *
   * Throws only for invalid input or persistence/service failures.
   */
  async claimNext(input: ClaimNextInput): Promise<ClaimNextResult | undefined> {
    const topicId = input.topicId.trim()
    const ownerId = input.ownerId.trim()
    if (topicId === '') throw new TaskServiceError('invalid_request', 'topicId must not be empty')
    if (ownerId === '') throw new TaskServiceError('invalid_request', 'ownerId must not be empty')
    const ttlMs = input.leaseTtlMs ?? this.defaultLeaseTtlMs
    if (!Number.isFinite(ttlMs) || ttlMs < 1) {
      throw new TaskServiceError('invalid_request', 'leaseTtlMs must be positive')
    }

    return this.runExclusive(topicId, async () => {
      const topic = await this.deps.topics.get(topicId)
      if (topic === undefined || topic.status !== 'active') return undefined

      const tasks = await this.deps.tasks.listByTopic(topicId)
      const active = tasks.find(task => ACTIVE_TASK_STATUSES.has(task.status))
      if (active !== undefined) {
        if (topic.activeTaskId !== active.id) {
          await this.deps.topics.save({
            ...topic,
            activeTaskId: active.id,
            updatedAt: this.deps.clock.now(),
          })
        }
        return undefined
      }

      if (topic.activeTaskId !== null) {
        await this.deps.topics.save({
          ...topic,
          activeTaskId: null,
          updatedAt: this.deps.clock.now(),
        })
      }

      const next = tasks
        .filter(task => task.status === 'queued')
        .sort((left, right) => left.seq - right.seq)[0]
      if (next === undefined) return undefined

      const existingLease = await this.deps.leases.findByTaskId(next.id)
      if (existingLease !== undefined && !isLeaseExpired(existingLease, this.deps.clock.now())) {
        return undefined
      }

      const now = this.deps.clock.now()
      const lease: TaskLease = {
        id: this.deps.ids.next('lease'),
        taskId: next.id,
        topicId,
        ownerId,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: now + ttlMs,
        ttlMs,
      }
      const transitioned = await this.taskService.transitionTask(next, 'dispatching', 'claimed')
      const updatedTopic: Topic = {
        ...transitioned.topic ?? topic,
        activeTaskId: next.id,
        updatedAt: now,
        lastActiveAt: now,
      }
      await this.deps.topics.save(updatedTopic)
      await this.deps.leases.save(lease)
      return { task: transitioned.task, topic: updatedTopic, lease }
    })
  }

  /**
   * Extend a live lease. Heartbeats after expiry fail with `lease_expired`;
   * recovery must be run explicitly instead of reviving the lease.
   */
  async heartbeat(leaseId: string, ownerId: string, at = this.deps.clock.now()): Promise<TaskLease> {
    const lease = await this.deps.leases.get(leaseId)
    if (lease === undefined) throw new TaskServiceError('not_found', `lease not found: ${leaseId}`)
    if (lease.ownerId !== ownerId) {
      throw new TaskServiceError('forbidden', `lease ${leaseId} is owned by another worker`)
    }
    if (isLeaseExpired(lease, at)) {
      throw new TaskServiceError('lease_expired', `lease ${leaseId} has expired`)
    }
    const updated: TaskLease = {
      ...lease,
      heartbeatAt: at,
      expiresAt: at + lease.ttlMs,
    }
    await this.deps.leases.save(updated)
    return updated
  }

  /**
   * Recover expired leases by moving their tasks to `needs_attention`.
   *
   * This deliberately does not re-enqueue tasks automatically: the previous
   * worker may have executed side effects. A human or a later retry policy can
   * decide whether a new attempt is safe.
   */
  async recoverExpiredLeases(at = this.deps.clock.now()): Promise<readonly RecoveredLease[]> {
    const expired = await this.deps.leases.listExpired(at)
    const recovered: RecoveredLease[] = []
    for (const lease of expired) {
      const currentLease = await this.deps.leases.get(lease.id)
      if (currentLease === undefined) continue
      const task = await this.deps.tasks.get(currentLease.taskId)
      if (task === undefined) {
        await this.deps.leases.delete(currentLease.id)
        recovered.push({ lease: currentLease, task: undefined, topic: undefined, reason: 'task_missing' })
        continue
      }
      if (!ACTIVE_TASK_STATUSES.has(task.status)) {
        await this.deps.leases.delete(currentLease.id)
        recovered.push({ lease: currentLease, task, topic: await this.deps.topics.get(task.topicId), reason: 'task_not_active' })
        continue
      }
      const result = await this.taskService.transitionTask(task, 'needs_attention', 'lease_expired', {
        error: {
          code: 'lease_expired',
          message: `task lease ${currentLease.id} expired`,
          retryable: true,
        },
      })
      await this.deps.leases.delete(currentLease.id)
      recovered.push({
        lease: currentLease,
        task: result.task,
        topic: result.topic,
        reason: 'lease_expired',
      })
    }
    return recovered
  }

  /** Read a lease by id (read-only diagnostic helper). */
  async getLease(leaseId: string): Promise<TaskLease | undefined> {
    return this.deps.leases.get(leaseId)
  }

  /**
   * Release a lease after the owner has finished (successfully or not).
   *
   * This does not mutate task state. The caller must first make the task
   * terminal or otherwise move it to a non-active state.
   */
  async releaseLease(leaseId: string, ownerId: string): Promise<void> {
    const lease = await this.deps.leases.get(leaseId)
    if (lease === undefined) return
    if (lease.ownerId !== ownerId) {
      throw new TaskServiceError('forbidden', `lease ${leaseId} is owned by another worker`)
    }
    await this.deps.leases.delete(leaseId)
  }

  private runExclusive<T>(topicId: TopicId, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(topicId) ?? Promise.resolve()
    const current = previous.then(task, task)
    const settled = current.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(topicId, settled)
    void settled.finally(() => {
      if (this.tails.get(topicId) === settled) this.tails.delete(topicId)
    })
    return current
  }
}
