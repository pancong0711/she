import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentAdapter } from '@she/agent-sdk'
import type {
  AgentAdapterDescriptor,
  AgentEventEnvelope,
  AgentHealth,
  AgentPromptRequest,
  AgentSessionRef,
  AgentSessionSpec,
  AgentSessionStatus,
} from '@she/protocol'
import { makeCapabilitySet } from '@she/protocol'
import {
  InMemoryArtifactRepository,
  InMemoryEventStore,
  InMemoryLeaseRepository,
  InMemoryTaskRepository,
  InMemoryTaskRequestStore,
  InMemoryTopicRepository,
  SequentialIdGenerator,
  TaskRunner,
  TaskService,
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

type FakeBehavior = 'success' | 'throw' | 'error-event' | 'no-turn-end'

class FakeAgent implements AgentAdapter {
  readonly descriptor: AgentAdapterDescriptor = {
    adapterId: 'fake',
    displayName: 'Fake Agent',
    version: '0.1.0',
    capabilities: makeCapabilitySet(['agent.session.create', 'agent.prompt', 'agent.event.stream']),
  }

  constructor(
    private readonly clock: FixedClock,
    private readonly behavior: FakeBehavior,
  ) {}

  async health(): Promise<AgentHealth> {
    return { adapterId: 'fake', ok: true, checkedAt: this.clock.now() }
  }

  async createSession(spec: AgentSessionSpec): Promise<AgentSessionRef> {
    return {
      adapterId: 'fake',
      sessionId: `session-${spec.sessionKey}`,
      sessionKey: spec.sessionKey,
      workspace: spec.workspace,
      createdAt: this.clock.now(),
    }
  }

  async resumeSession(sessionId: string): Promise<AgentSessionRef> {
    return {
      adapterId: 'fake',
      sessionId,
      sessionKey: 'topic-000001',
      workspace: { key: 'workspace-1' },
      createdAt: this.clock.now(),
    }
  }

  async *prompt(_input: AgentPromptRequest): AsyncIterable<AgentEventEnvelope> {
    if (this.behavior === 'throw') throw new Error('fake agent exploded')
    yield {
      eventId: 'event-1',
      sessionId: 'session-topic-000001',
      sequence: 1,
      emittedAt: this.clock.now(),
      event: { kind: 'text-delta', text: 'working' },
    }
    if (this.behavior === 'error-event') {
      yield {
        eventId: 'event-2',
        sessionId: 'session-topic-000001',
        sequence: 2,
        emittedAt: this.clock.now(),
        event: {
          kind: 'error',
          error: { code: 'internal', message: 'fake model failed', retryable: true },
        },
      }
      return
    }
    if (this.behavior === 'no-turn-end') return
    yield {
      eventId: 'event-2',
      sessionId: 'session-topic-000001',
      sequence: 2,
      emittedAt: this.clock.now(),
      event: { kind: 'turn-end', reason: 'completed' },
    }
  }

  async cancel(_sessionId: string): Promise<void> {}

  async status(sessionId: string): Promise<AgentSessionStatus> {
    return { sessionId, state: 'idle' }
  }

  async dispose(_sessionId: string): Promise<void> {}
}

const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

function createHarness(behavior: FakeBehavior = 'success') {
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
    topics,
    tasks,
    requests,
    leases,
    events,
    artifacts,
    service: new TaskService(deps),
    runner: new TaskRunner({ ...deps, agent: new FakeAgent(clock, behavior) }, { defaultLeaseTtlMs: 100 }),
  }
}

describe('TaskRunner', () => {
  it('runs a queued task through a fake agent to succeeded', async () => {
    const { service, runner, tasks, requests, leases, events } = createHarness('success')
    const submitted = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'please do the thing',
    })

    const result = await runner.runNext({ topicId: submitted.topic.id, ownerId: 'worker-1' })
    expect(result?.finalStatus).toBe('succeeded')
    expect(result?.task.agentSessionId).toBe(`session-${submitted.topic.id}`)
    expect(result?.agentEvents.map(event => event.event.kind)).toEqual(['text-delta', 'turn-end'])
    expect(result?.topic.activeTaskId).toBeNull()
    expect((await tasks.get(submitted.task.id))?.status).toBe('succeeded')
    expect(await requests.get(submitted.task.id)).toBeUndefined()
    expect(await leases.findByTaskId(submitted.task.id)).toBeUndefined()
    const page = await events.readAfter(null)
    expect(page.events.some(item => item.event.type === 'task.agent_event')).toBe(true)
  })

  it('persists a markdown report artifact for a successful task workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'she-report-'))
    cleanup.push(async () => rm(workspace, { recursive: true, force: true }))
    const { service, runner, artifacts, events } = createHarness('success')
    const submitted = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'write a report',
    })
    const result = await runner.runNext({ topicId: submitted.topic.id, ownerId: 'worker-1', workspacePath: workspace })
    expect(result?.finalStatus).toBe('succeeded')
    expect(result?.task.reportArtifactId).toBeTruthy()
    const list = await artifacts.listByTask(submitted.task.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'report', fileName: `${submitted.task.id}.md` })
    const report = await readFile(join(workspace, list[0].storageRef), 'utf8')
    expect(report).toContain('# SHE task report')
    expect(report).toContain('working')
    const page = await events.readAfter(null)
    expect(page.events.some(item => item.event.type === 'artifact.created')).toBe(true)
  })

  it('marks the task failed and releases its lease when the adapter throws', async () => {
    const { service, runner, tasks, requests, leases } = createHarness('throw')
    const submitted = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'fail this task',
    })

    const result = await runner.runNext({ topicId: submitted.topic.id, ownerId: 'worker-1' })
    expect(result?.finalStatus).toBe('failed')
    expect(result?.task.error).toMatchObject({ code: 'agent_error' })
    expect((await tasks.get(submitted.task.id))?.status).toBe('failed')
    expect(await requests.get(submitted.task.id)).toBeUndefined()
    expect(await leases.findByTaskId(submitted.task.id)).toBeUndefined()
  })

  it('turns an agent error event into a failed task', async () => {
    const { service, runner } = createHarness('error-event')
    const submitted = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'return an error',
    })

    const result = await runner.runNext({ topicId: submitted.topic.id, ownerId: 'worker-1' })
    expect(result?.finalStatus).toBe('failed')
    expect(result?.task.error).toMatchObject({ code: 'internal', message: 'fake model failed' })
  })

  it('fails closed when prompt stream ends without turn-end', async () => {
    const { service, runner } = createHarness('no-turn-end')
    const submitted = await service.submit({
      conversationKey: 'chat-1',
      workspaceKey: 'workspace-1',
      request: 'forget to end',
    })

    const result = await runner.runNext({ topicId: submitted.topic.id, ownerId: 'worker-1' })
    expect(result?.finalStatus).toBe('failed')
    expect(result?.task.error?.code).toBe('turn_end_missing')
  })

  it('returns undefined when the queue is empty', async () => {
    const { runner } = createHarness()
    expect(await runner.runNext({ topicId: 'missing', ownerId: 'worker-1' })).toBeUndefined()
  })
})
