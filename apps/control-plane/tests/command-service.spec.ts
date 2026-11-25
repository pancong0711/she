import { describe, expect, it } from 'vitest'
import {
  InMemoryArtifactRepository,
  InMemoryEventStore,
  InMemoryTaskRepository,
  InMemoryTaskRequestStore,
  InMemoryTopicRepository,
  SequentialIdGenerator,
  SystemClock,
  TaskService,
} from '@she/control'
import type { GatewayCommandInvocation } from '@she/protocol'
import { SheCommandService, resolveControlPlaneConfig } from '@she/control-plane'

function createCommand(text: string, requestId = 'req-1'): GatewayCommandInvocation {
  return {
    kind: 'command',
    requestId,
    actor: { id: 'user-1', kind: 'user' },
    conversation: { id: 'chat-1', kind: 'dm' },
    rawCommand: text,
  }
}

function createService() {
  const clock = new SystemClock()
  const events = new InMemoryEventStore()
  const tasks = new InMemoryTaskRepository()
  const commands = new TaskService({
    clock,
    ids: new SequentialIdGenerator(),
    topics: new InMemoryTopicRepository(),
    tasks,
    artifacts: new InMemoryArtifactRepository(),
    requests: new InMemoryTaskRequestStore(),
    events,
  })
  return { service: new SheCommandService({ commands, tasks, events, clock }), tasks }
}

describe('SheCommandService', () => {
  it('returns a help card and handles unknown commands', async () => {
    const { service } = createService()
    const help = await service.command(createCommand('/she help'))
    expect(help.accepted).toBe(true)
    expect(help.commandResult?.renderIntents[0]?.kind).toBe('card')
    const unknown = await service.command(createCommand('/she nope'))
    expect(unknown.accepted).toBe(false)
    expect(unknown.commandResult?.renderIntents[0]).toMatchObject({ kind: 'text' })
  })

  it('submits, lists, reports status and cancels a task', async () => {
    const { service, tasks } = createService()
    const submitted = await service.command(createCommand('/she submit implement feature', 'req-submit'))
    expect(submitted.accepted).toBe(true)
    expect(submitted.taskId).toBeTypeOf('string')
    const taskId = submitted.taskId
    if (taskId === undefined) throw new Error('task id expected')

    const list = await service.command(createCommand('/she list', 'req-list'))
    expect(list.commandResult?.renderIntents[0]).toMatchObject({ kind: 'card', title: 'SHE tasks · 1' })

    const status = await service.command(createCommand(`/she status ${taskId}`, 'req-status'))
    expect(status.accepted).toBe(true)
    expect(status.commandResult?.renderIntents[0]).toMatchObject({ kind: 'card', title: `Task ${taskId}` })

    const snapshot = await service.snapshot()
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.cursor).toBe('evt:2')

    const cancelled = await service.command(createCommand(`/she cancel ${taskId}`, 'req-cancel'))
    expect(cancelled.accepted).toBe(true)
    expect((await tasks.get(taskId))?.status).toBe('cancelled')
  })

  it('returns not-found and usage errors as render intents', async () => {
    const { service } = createService()
    const notFound = await service.command(createCommand('/she status missing', 'req-nf'))
    expect(notFound.accepted).toBe(false)
    const usage = await service.command(createCommand('/she submit', 'req-usage'))
    expect(usage.accepted).toBe(false)
  })
})

describe('resolveControlPlaneConfig', () => {
  it('uses deterministic XDG defaults and environment overrides', () => {
    const defaults = resolveControlPlaneConfig({})
    expect(defaults.socketPath.endsWith('/she/control.sock')).toBe(true)
    expect(defaults.databasePath.endsWith('/she/she.db')).toBe(true)

    const overridden = resolveControlPlaneConfig({
      XDG_RUNTIME_DIR: '/run/user/1000',
      XDG_STATE_HOME: '/state',
      XDG_CONFIG_HOME: '/config',
      SHE_CONTROL_SOCKET: '/tmp/custom.sock',
      SHE_DB_PATH: '/tmp/custom.db',
    })
    expect(overridden).toMatchObject({
      socketPath: '/tmp/custom.sock',
      databasePath: '/tmp/custom.db',
      tokenFile: '/config/she/token',
    })
  })
})
