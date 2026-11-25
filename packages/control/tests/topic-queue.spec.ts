import { describe, expect, it } from 'vitest'
import {
  InMemoryArtifactRepository,
  InMemoryEventStore,
  InMemoryLeaseRepository,
  InMemoryTaskRepository,
  InMemoryTaskRequestStore,
  InMemoryTopicRepository,
  SequentialIdGenerator,
  TaskService,
  TaskServiceError,
  TopicQueue,
} from '@she/control'

class FixedClock {
  constructor(private value: number) {}
  now(): number {
    return this.value
  }
  advance(ms: number): void {
    this.value += ms
  }
}

function createHarness() {
  const clock = new FixedClock(1_000)
  const ids = new SequentialIdGenerator()
  const events = new InMemoryEventStore()
  const topics = new InMemoryTopicRepository()
  const tasks = new InMemoryTaskRepository()
  const artifacts = new InMemoryArtifactRepository()
  const requests = new InMemoryTaskRequestStore()
  const leases = new InMemoryLeaseRepository()
  const deps = { clock, ids, topics, tasks, artifacts, requests, events, leases }
  return {
    clock,
    events,
    topics,
    tasks,
    leases,
    service: new TaskService(deps),
    queue: new TopicQueue(deps, { defaultLeaseTtlMs: 100 }),
  }
}

async function submitTwo(service: TaskService) {
  const first = await service.submit({
    conversationKey: 'chat-1',
    workspaceKey: 'workspace-1',
    request: 'first task',
  })
  const second = await service.submit({
    conversationKey: 'chat-1',
    workspaceKey: 'workspace-1',
    request: 'second task',
  })
  return { topicId: first.topic.id, first: first.task, second: second.task }
}

describe('TopicQueue', () => {
  it('claims one task at a time and marks the topic active', async () => {
    const { service, queue } = createHarness()
    const { topicId, first } = await submitTwo(service)

    const claimed = await queue.claimNext({ topicId, ownerId: 'worker-1' })
    expect(claimed?.task.id).toBe(first.id)
    expect(claimed?.task.status).toBe('dispatching')
    expect(claimed?.topic.activeTaskId).toBe(first.id)
    expect(claimed?.lease.ownerId).toBe('worker-1')
    expect(claimed?.lease.expiresAt).toBe(1_100)

    const blocked = await queue.claimNext({ topicId, ownerId: 'worker-2' })
    expect(blocked).toBeUndefined()
  })

  it('serializes concurrent claims for the same topic', async () => {
    const { service, queue } = createHarness()
    const { topicId } = await submitTwo(service)

    const results = await Promise.all([
      queue.claimNext({ topicId, ownerId: 'worker-1' }),
      queue.claimNext({ topicId, ownerId: 'worker-2' }),
      queue.claimNext({ topicId, ownerId: 'worker-3' }),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('claims the next task after the current task reaches a terminal state', async () => {
    const { service, queue, clock } = createHarness()
    const { topicId, first, second } = await submitTwo(service)
    const claimed = await queue.claimNext({ topicId, ownerId: 'worker-1' })
    expect(claimed?.task.id).toBe(first.id)

    clock.advance(10)
    await service.transitionTask(first.id, 'failed', 'worker reported failure')
    const next = await queue.claimNext({ topicId, ownerId: 'worker-2' })
    expect(next?.task.id).toBe(second.id)
  })

  it('heartbeats only for the owner and extends expiry', async () => {
    const { service, queue, clock } = createHarness()
    const { topicId } = await submitTwo(service)
    const claimed = await queue.claimNext({ topicId, ownerId: 'worker-1' })
    if (claimed === undefined) throw new Error('claim expected')

    clock.advance(50)
    const renewed = await queue.heartbeat(claimed.lease.id, 'worker-1')
    expect(renewed.heartbeatAt).toBe(1_050)
    expect(renewed.expiresAt).toBe(1_150)
    await expect(queue.heartbeat(claimed.lease.id, 'worker-2')).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('recovers expired leases into needs_attention without silent redispatch', async () => {
    const { service, queue, clock } = createHarness()
    const { topicId, first, second } = await submitTwo(service)
    const claimed = await queue.claimNext({ topicId, ownerId: 'worker-1' })
    if (claimed === undefined) throw new Error('claim expected')

    clock.advance(101)
    await expect(queue.heartbeat(claimed.lease.id, 'worker-1')).rejects.toMatchObject({
      code: 'lease_expired',
    })
    const recovered = await queue.recoverExpiredLeases()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.reason).toBe('lease_expired')
    expect(recovered[0]?.task?.status).toBe('needs_attention')
    expect(recovered[0]?.task?.error?.code).toBe('lease_expired')
    expect(recovered[0]?.topic?.activeTaskId).toBeNull()
    expect(await queue.getLease(claimed.lease.id)).toBeUndefined()

    const next = await queue.claimNext({ topicId, ownerId: 'worker-2' })
    expect(next?.task.id).toBe(second.id)
    expect(next?.task.id).not.toBe(first.id)
    expect(await service.getTask(first.id)).toMatchObject({ status: 'needs_attention' })
  })

  it('returns undefined for empty, paused and busy topics', async () => {
    const { service, queue, topics } = createHarness()
    const { topicId } = await submitTwo(service)

    expect(await queue.claimNext({ topicId: 'missing', ownerId: 'worker-1' })).toBeUndefined()

    const topic = await topics.get(topicId)
    if (topic === undefined) throw new Error('topic expected')
    await topics.save({ ...topic, status: 'paused' })
    expect(await queue.claimNext({ topicId, ownerId: 'worker-1' })).toBeUndefined()

    await topics.save({ ...topic, status: 'active' })
    const first = await queue.claimNext({ topicId, ownerId: 'worker-1' })
    expect(first).toBeDefined()
    expect(await queue.claimNext({ topicId, ownerId: 'worker-2' })).toBeUndefined()
  })

  it('releases a lease only for its owner', async () => {
    const { service, queue } = createHarness()
    const { topicId } = await submitTwo(service)
    const claimed = await queue.claimNext({ topicId, ownerId: 'worker-1' })
    if (claimed === undefined) throw new Error('claim expected')

    await expect(queue.releaseLease(claimed.lease.id, 'worker-2')).rejects.toMatchObject({
      code: 'forbidden',
    })
    await queue.releaseLease(claimed.lease.id, 'worker-1')
    expect(await queue.getLease(claimed.lease.id)).toBeUndefined()
  })

  it('validates claim input', async () => {
    const { queue } = createHarness()
    await expect(queue.claimNext({ topicId: '  ', ownerId: 'worker' })).rejects.toBeInstanceOf(TaskServiceError)
    await expect(queue.claimNext({ topicId: 'topic', ownerId: '' })).rejects.toBeInstanceOf(TaskServiceError)
  })
})
