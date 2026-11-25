/** Task lease domain type and expiry helpers. */

import type { TaskId, TopicId } from './domain.js'

/**
 * A lease grants one owner the right to drive one dispatched task.
 *
 * Invariants:
 * - at most one non-expired lease may exist for a task;
 * - at most one task may be active per topic;
 * - only the lease owner may heartbeat the lease;
 * - an expired lease is never silently renewed; recovery must mark the task
 *   needs_attention so a human/control-plane policy can decide what to do.
 */
export interface TaskLease {
  readonly id: string
  readonly taskId: TaskId
  readonly topicId: TopicId
  readonly ownerId: string
  readonly acquiredAt: number
  readonly heartbeatAt: number
  readonly expiresAt: number
  /** Lease duration used by heartbeat to extend the expiry. */
  readonly ttlMs: number
}

export function isLeaseExpired(lease: TaskLease, at: number): boolean {
  return lease.expiresAt <= at
}
