import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SheClient } from '@she/client'
import { SheGatewayBridge } from '@she/gateway-sdk'
import type {
  GatewayAdapter,
  GatewayAdapterDescriptor,
  GatewayInboundEvent,
  GatewayInboundSink,
  GatewayTaskEvent,
  RenderIntent,
  RenderReceipt,
  RenderTarget,
} from '@she/gateway-sdk'
import type { GatewayCommandInvocation, RenderIntent as ProtocolRenderIntent } from '@she/protocol'
import { makeCapabilitySet } from '@she/protocol'
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
import { ControlPlaneServer, SheCommandService } from '@she/control-plane'

const cleanup: (() => Promise<void>)[] = []

class RecordingGatewayAdapter implements GatewayAdapter {
  readonly descriptor: GatewayAdapterDescriptor = {
    adapterId: 'fake-channel',
    displayName: 'Fake channel',
    version: '0.1.0',
    capabilities: makeCapabilitySet(['text.inbound', 'text.outbound', 'card.outbound']),
  }
  sink: GatewayInboundSink | undefined
  readonly renders: Array<{ target: RenderTarget; intent: RenderIntent }> = []
  readonly taskEvents: GatewayTaskEvent[] = []

  async start(sink: GatewayInboundSink): Promise<void> {
    this.sink = sink
  }

  async render(target: RenderTarget, intent: RenderIntent): Promise<RenderReceipt> {
    this.renders.push({ target, intent })
    return { renderId: intent.renderId, sequence: intent.sequence, deliveredAt: Date.now() }
  }

  async onTaskEvent(event: GatewayTaskEvent): Promise<void> {
    this.taskEvents.push(event)
  }

  async stop(): Promise<void> {}
}

function command(text: string, requestId: string): GatewayCommandInvocation {
  return {
    kind: 'command',
    requestId,
    actor: { id: 'user-1', kind: 'user' },
    conversation: { id: 'chat-1', kind: 'dm' },
    rawCommand: text,
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition timed out')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

describe('SheGatewayBridge', () => {
  it('passes approval and file intents to the adapter without platform JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'she-bridge-file-'))
    cleanup.push(async () => rm(dir, { recursive: true, force: true }))
    const socketPath = join(dir, 'control.sock')
    const eventStore = new InMemoryEventStore()
    const approval: ProtocolRenderIntent = {
      kind: 'approval',
      renderId: 'approval-1',
      sequence: 1,
      interactionId: 'interaction-approval',
      title: 'Approve file?',
      body: 'send artifact',
    }
    const file: ProtocolRenderIntent = {
      kind: 'file',
      renderId: 'file-1',
      sequence: 1,
      artifact: { id: 'artifact-1', fileName: 'report.md', bytes: 12 },
      approval: 'always',
    }
    const server = new ControlPlaneServer({
      socketPath,
      serverVersion: '0.1.0',
      handlers: {
        async command(input) {
          return {
            accepted: true,
            requestId: input.requestId,
            commandResult: { renderIntents: [approval, file] },
          }
        },
        async interaction(input) {
          return { accepted: true, interactionId: input.interactionId }
        },
        async snapshot() {
          return { protocolVersion: 'gateway.v1', generatedAt: Date.now(), cursor: null, tasks: [] }
        },
      },
      eventStore,
      eventPollIntervalMs: 5,
      clock: { now: () => Date.now() },
    })
    await server.start()
    cleanup.push(async () => server.close())
    const client = new SheClient({ socketPath, timeoutMs: 1_000 })
    const adapter = new RecordingGatewayAdapter()
    const bridge = new SheGatewayBridge({ client, adapter })
    await bridge.start()
    cleanup.push(async () => {
      await bridge.stop()
      await client.close()
    })
    await adapter.sink?.onInbound(command('/she approve', 'req-approval'))
    expect(adapter.renders.map(item => item.intent.kind)).toEqual(['approval', 'file'])
  })

  it('forwards commands, renders intents and task events without platform types', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'she-bridge-'))
    cleanup.push(async () => rm(dir, { recursive: true, force: true }))
    const socketPath = join(dir, 'control.sock')
    const clock = new SystemClock()
    const tasks = new InMemoryTaskRepository()
    const events = new InMemoryEventStore()
    const commands = new TaskService({
      clock,
      ids: new SequentialIdGenerator(),
      topics: new InMemoryTopicRepository(),
      tasks,
      artifacts: new InMemoryArtifactRepository(),
      requests: new InMemoryTaskRequestStore(),
      events,
    })
    const commandService = new SheCommandService({
      commands,
      tasks,
      events,
      clock,
    })
    const server = new ControlPlaneServer({
      socketPath,
      serverVersion: '0.1.0',
      handlers: commandService,
      eventStore: events,
      eventPollIntervalMs: 5,
      heartbeatIntervalMs: 10_000,
      clock: { now: () => Date.now() },
    })
    await server.start()
    cleanup.push(async () => server.close())

    const client = new SheClient({ socketPath, timeoutMs: 1_000 })
    const adapter = new RecordingGatewayAdapter()
    const bridge = new SheGatewayBridge({ client, adapter })
    await bridge.start()
    cleanup.push(async () => {
      await bridge.stop()
      await client.close()
    })
    if (adapter.sink === undefined) throw new Error('sink not registered')

    await adapter.sink.onInbound(command('/she help', 'req-help'))
    expect(adapter.renders[0]?.intent).toMatchObject({ kind: 'card', title: 'SHE help' })

    await adapter.sink.onInbound(command('/she submit implement bridge', 'req-submit'))
    expect(adapter.renders[1]?.intent).toMatchObject({ kind: 'text' })

    await waitFor(() => adapter.taskEvents.some(event => event.type === 'task.accepted'))
    expect(adapter.taskEvents.some(event => event.type === 'task.accepted')).toBe(true)

    await adapter.sink.onInbound({
      kind: 'interaction',
      requestId: 'req-interaction',
      actor: { id: 'user-1', kind: 'user' },
      conversation: { id: 'chat-1', kind: 'dm' },
      interactionId: 'interaction-1',
      values: { decision: 'approve' },
    })
    expect(adapter.renders.at(-1)?.intent).toMatchObject({ kind: 'text' })
  })
})
