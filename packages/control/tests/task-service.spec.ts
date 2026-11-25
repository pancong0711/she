import { describe, expect, it } from 'vitest'
import { eventCursor, parseEventCursor } from '@she/core'
import {
  InMemoryArtifactRepository,
  InMemoryEventStore,
  InMemoryTaskRepository,
  InMemoryTaskRequestStore,
  InMemoryTopicRepository,
  SequentialIdGenerator,
  TaskService,
  TaskServiceError,
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

function createService() {
  const clock = new FixedClock(1_000)
  const events = new InMemoryEventStore()
  const service = new TaskService({
    clock,
    ids: new SequentialIdGenerator(),
    topics: new InMemoryTopicRepository(),
    tasks: new InMemoryTaskRepository(),
    artifacts: new InMemoryArtifactRepository(),
    requests: new InMemoryTaskRequestStore(),
    events,
  })
  return { service, events, clock }
}

describe('event cursor', () => {
  it('round-trips and rejects malformed cursors', () => {
    expect(eventCursor(1)).toBe('evt:1')
    expect(parseEventCursor('evt:42')).toBe(42)
    expect(() => parseEventCursor('42')).toThrow()
    expect(() => parseEventCursor('evt:0')).toThrow()
  })
})

describe('TaskService', () => {
  it('creates a topic on first submit and queues a task', async () => {
    const { service } = createService()
    const result = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: '  implement the task service  ',
      idempotencyKey: 'idem-1',
    })

    expect(result.deduplicated).toBe(false)
    expect(result.topic.conversationKey).toBe('chat-1')
    expect(result.topic.displayNo).toBe('1')
    expect(result.task.status).toBe('queued')
    expect(result.task.seq).toBe(1)
    expect(result.task.requestExcerpt).toBe('implement the task s')
    expect(result.events.map(item => item.event.type)).toEqual(['topic.created', 'task.enqueued'])
  })

  it('deduplicates by idempotency key without appending events', async () => {
    const { service, events } = createService()
    const input = {
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'do work',
      idempotencyKey: 'idem-1',
    }
    const first = await service.submit(input)
    const second = await service.submit(input)

    expect(second.deduplicated).toBe(true)
    expect(second.task.id).toBe(first.task.id)
    expect(second.events).toEqual([])
    expect((await events.readAfter(null)).events).toHaveLength(2)
  })

  it('serializes task sequence within one active topic', async () => {
    const { service, clock } = createService()
    const first = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'first',
    })
    clock.advance(10)
    const second = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'second',
    })

    expect(second.topic.id).toBe(first.topic.id)
    expect(second.task.seq).toBe(2)
    expect(await service.listTasks('chat-1')).toHaveLength(2)
  })

  it('cancels a queued task and rejects repeated cancellation', async () => {
    const { service, events, clock } = createService()
    const created = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'cancel me',
    })
    clock.advance(5)
    const cancelled = await service.cancelTask(created.task.id, 'user requested')

    expect(cancelled.task.status).toBe('cancelled')
    expect(cancelled.task.finishedAt).toBe(1_005)
    expect(cancelled.event?.event.type).toBe('task.status_changed')
    await expect(service.cancelTask(created.task.id)).rejects.toBeInstanceOf(TaskServiceError)

    const page = await events.readAfter(eventCursor(2))
    expect(page.events).toHaveLength(1)
    expect(page.events[0]?.event.type).toBe('task.status_changed')
  })

  it('rejects empty requests and missing tasks', async () => {
    const { service } = createService()
    await expect(
      service.submit({ conversationKey: 'chat-1', workspaceKey: 'workspace-1', request: '   ' }),
    ).rejects.toBeInstanceOf(TaskServiceError)
    await expect(service.cancelTask('missing')).rejects.toBeInstanceOf(TaskServiceError)
  })
})
