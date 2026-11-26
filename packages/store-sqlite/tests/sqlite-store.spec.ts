import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  InMemoryEventStore,
  SequentialIdGenerator,
  TaskService,
  TopicQueue,
} from '@she/control'
import { SqliteStore } from '@she/store-sqlite'

const cleanup: (() => Promise<void>)[] = []

async function databasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'she-sqlite-'))
  cleanup.push(async () => rm(dir, { recursive: true, force: true }))
  return join(dir, 'she.db')
}

class FixedClock {
  constructor(private value: number) {}
  now(): number {
    return this.value
  }
  advance(ms: number): void {
    this.value += ms
  }
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

describe('SQLite store', () => {
  it('applies migrations idempotently and persists tasks/events across reopen', async () => {
    const path = await databasePath()
    const clock = new FixedClock(1_000)
    const ids = new SequentialIdGenerator()
    const first = SqliteStore.open(path)
    const service = new TaskService({
      clock,
      ids,
      topics: first.topics,
      tasks: first.tasks,
      artifacts: first.artifacts,
      requests: first.requests,
      events: first.events,
    })
    const submitted = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'persist me',
      idempotencyKey: 'idem-persist',
    })
    expect(first.schemaVersion()).toBe(2)
    first.close()

    const second = SqliteStore.open(path)
    const reloaded = await second.tasks.get(submitted.task.id)
    expect(reloaded?.status).toBe('queued')
    expect(reloaded?.requestExcerpt).toBe('persist me')
    expect(await second.tasks.findByIdempotencyKey('idem-persist')).toMatchObject({
      id: submitted.task.id,
    })
    const events = await second.events.readAfter(null)
    expect(events.events.map(item => item.event.type)).toEqual(['topic.created', 'task.enqueued'])
    expect(second.schemaVersion()).toBe(2)
    second.close()
  })

  it('creates a missing database parent directory and protects the database file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'she-sqlite-parent-'))
    cleanup.push(async () => rm(root, { recursive: true, force: true }))
    const path = join(root, 'missing', 'nested', 'she.db')
    const store = SqliteStore.open(path)
    expect(store.schemaVersion()).toBe(2)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    store.close()
  })

  it('persists leases and recovers expired tasks after reopen', async () => {
    const path = await databasePath()
    const clock = new FixedClock(1_000)
    const ids = new SequentialIdGenerator()
    const first = SqliteStore.open(path)
    const deps = {
      clock,
      ids,
      topics: first.topics,
      tasks: first.tasks,
      artifacts: first.artifacts,
      requests: first.requests,
      events: first.events,
      leases: first.leases,
    }
    const service = new TaskService(deps)
    const queue = new TopicQueue(deps, { defaultLeaseTtlMs: 100 })
    const submitted = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'run then expire',
    })
    const claimed = await queue.claimNext({ topicId: submitted.topic.id, ownerId: 'worker-1' })
    expect(claimed?.lease.expiresAt).toBe(1_100)
    first.close()

    const second = SqliteStore.open(path)
    clock.advance(101)
    const reopened = {
      clock,
      ids,
      topics: second.topics,
      tasks: second.tasks,
      artifacts: second.artifacts,
      requests: second.requests,
      events: second.events,
      leases: second.leases,
    }
    const recovered = await new TopicQueue(reopened, { defaultLeaseTtlMs: 100 }).recoverExpiredLeases()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.task?.status).toBe('needs_attention')
    expect(await second.leases.get(claimed?.lease.id ?? '')).toBeUndefined()
    expect(await second.tasks.get(submitted.task.id)).toMatchObject({ status: 'needs_attention' })
    second.close()
  })

  it('persists artifacts and keeps event cursor ordering', async () => {
    const path = await databasePath()
    const store = SqliteStore.open(path)
    const base = {
      eventId: 'event-1',
      aggregateType: 'artifact' as const,
      aggregateId: 'artifact-1',
      type: 'artifact.created' as const,
      occurredAt: 1_000,
      payload: { artifactId: 'artifact-1', taskId: 'task-1', kind: 'report' as const, fileName: 'report.md', bytes: 12 },
    }
    await store.events.append([base])
    const page = await store.events.readAfter(null, 10)
    expect(page.events).toHaveLength(1)
    expect(page.nextCursor).toBe('evt:1')
    expect(page.hasMore).toBe(false)

    await store.artifacts.save({
      id: 'artifact-1',
      taskId: 'task-1',
      kind: 'report',
      fileName: 'report.md',
      bytes: 12,
      sha256: 'abc',
      storageRef: 'artifact://task-1/report.md',
      createdAt: 1_000,
    })
    expect(await store.artifacts.get('artifact-1')).toMatchObject({
      fileName: 'report.md',
      storageRef: 'artifact://task-1/report.md',
    })
    store.close()
  })

  it('exposes a small in-memory compatibility path for control tests', () => {
    const events = new InMemoryEventStore()
    expect(events).toBeDefined()
  })
})
