import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryArtifactRepository, InMemoryEventStore } from '@she/control'
import { SheClient, SheClientError } from '@she/client'
import type { SheDomainEvent } from '@she/core'
import {
  GATEWAY_PROTOCOL_VERSION,
  GATEWAY_V1_FIXTURES,
  makeCapabilitySet,
  type GatewayCommandInvocation,
  type GatewayInteractionResponse,
  type AgentRuntimeStatus,
} from '@she/protocol'
import { ControlPlaneServer } from '@she/control-plane'

const cleanup: (() => Promise<void>)[] = []

function domainTaskEvent(eventId: string, sequence: number): SheDomainEvent {
  return {
    eventId,
    aggregateType: 'task',
    aggregateId: `task-${sequence}`,
    type: 'task.enqueued',
    occurredAt: 1_700_000_000_000 + sequence,
    payload: {
      taskId: `task-${sequence}`,
      topicId: 'topic-1',
      seq: sequence,
      priority: 'interactive',
      queuePosition: sequence,
    },
  }
}

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'she-server-'))
  const socketPath = join(dir, 'control.sock')
  const eventStore = new InMemoryEventStore()
  const artifacts = new InMemoryArtifactRepository()
  const artifactRoot = join(dir, 'workspace')
  await mkdir(join(artifactRoot, '.she', 'reports'), { recursive: true })
  const reportBytes = Buffer.from('# SHE report\n\ncompleted\n', 'utf8')
  await writeFile(join(artifactRoot, '.she', 'reports', 'task-1.md'), reportBytes)
  await artifacts.save({
    id: 'artifact-1',
    taskId: 'task-1',
    kind: 'report',
    fileName: 'task-1.md',
    bytes: reportBytes.byteLength,
    sha256: 'a'.repeat(64),
    storageRef: '.she/reports/task-1.md',
    createdAt: 1_700_000_000_000,
  })
  const command = GATEWAY_V1_FIXTURES.commandRequest.command as GatewayCommandInvocation
  const handlers = {
    async command(input: GatewayCommandInvocation) {
      expect(input.requestId).toBe(command.requestId)
      return GATEWAY_V1_FIXTURES.commandResult
    },
    async interaction(input: GatewayInteractionResponse) {
      return { accepted: true, interactionId: input.interactionId }
    },
    async snapshot() {
      return GATEWAY_V1_FIXTURES.snapshot
    },
  }
  const agentStatus: AgentRuntimeStatus = {
    configured: true,
    adapterId: 'opencode',
    displayName: 'OpenCode',
    url: 'http://127.0.0.1:49375',
    username: 'opencode',
    credentialFile: '/home/test/.config/opencode/service.json',
    health: { adapterId: 'opencode', ok: true, version: '2.0.0', checkedAt: 1_700_000_000_000 },
    workspace: {
      key: 'worker-default',
      path: '/home/test/workspace',
      realPath: '/home/test/workspace',
      source: 'SHE_WORKSPACE_PATH',
      exists: true,
      isDirectory: true,
      readable: true,
      writable: true,
      executable: true,
      readOnly: false,
      leafAuthorized: true,
      warnings: [],
    },
  }
  const server = new ControlPlaneServer({
    socketPath,
    token: 'test-token',
    serverVersion: '0.1.0',
    capabilities: makeCapabilitySet(['text.inbound', 'text.outbound']),
    handlers,
    eventStore,
    workerStatus: () => ({ enabled: true, state: 'idle', updatedAt: 1_700_000_000_000 }),
    agentStatus: () => agentStatus,
    artifacts,
    artifactRoot,
    eventPollIntervalMs: 5,
    heartbeatIntervalMs: 10_000,
    clock: { now: () => 1_700_000_000_000 },
  })
  await server.start()
  cleanup.push(async () => {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  })
  return { socketPath, eventStore, artifacts, artifactRoot, client: new SheClient({ socketPath, token: 'test-token', timeoutMs: 1_000 }) }
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

describe('control-plane gateway.v1 server', () => {
  it('serves health, hello, command, interaction and snapshot', async () => {
    const { client } = await harness()
    const health = await client.health()
    expect(health.protocolVersion).toBe(GATEWAY_PROTOCOL_VERSION)
    expect(health.service).toBe('she-control-plane')

    const welcome = await client.hello()
    expect(welcome.capabilities.values).toContain('text.outbound')

    const commandResult = await client.command(GATEWAY_V1_FIXTURES.commandRequest.command)
    expect(commandResult.commandResult?.renderIntents).toHaveLength(2)

    const interactionResult = await client.interaction({
      kind: 'interaction',
      requestId: 'req-int',
      actor: { id: 'user-1', kind: 'user' },
      conversation: { id: 'chat-1', kind: 'dm' },
      interactionId: 'interaction-1',
      values: { decision: 'approve' },
    })
    expect(interactionResult.interactionId).toBe('interaction-1')

    const snapshot = await client.snapshot()
    expect(snapshot.cursor).toBe('evt:1')
    expect(snapshot.tasks).toHaveLength(1)
  })

  it('serves read-only agent health and workspace authorization status', async () => {
    const { client } = await harness()
    const status = await client.agents()
    expect(status).toMatchObject({
      configured: true,
      adapterId: 'opencode',
      health: { ok: true, version: '2.0.0' },
      workspace: { leafAuthorized: true, readOnly: false, writable: true },
    })
    expect(JSON.stringify(status)).not.toContain('credentialContent')
  })

  it('lists and downloads persisted task report artifacts', async () => {
    const { client } = await harness()
    const list = await client.artifacts('task-1')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'artifact-1', fileName: 'task-1.md', downloadPath: '/v1/artifacts/artifact-1/download' })
    const download = await client.downloadArtifact('artifact-1')
    expect(Buffer.from(download.bytes).toString('utf8')).toContain('# SHE report')
    expect(download.contentType).toContain('text/markdown')
  })

  it('returns structured errors for authentication failures', async () => {
    const { socketPath } = await harness()
    const client = new SheClient({ socketPath, token: 'wrong-token', timeoutMs: 1_000 })
    await expect(client.health()).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('streams mapped task events as NDJSON', async () => {
    const { client, eventStore } = await harness()
    await eventStore.append([domainTaskEvent('event-1', 1)])
    const iterator = client.events()[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.value).toMatchObject({
      type: 'task',
      event: { type: 'task.accepted', taskId: 'task-1', topicId: 'topic-1' },
    })
    await iterator.return?.()
  })

  it('rejects cursors older than the replay window with cursor_expired', async () => {
    const { client, eventStore } = await harness()
    await eventStore.append([
      domainTaskEvent('event-1', 1),
      domainTaskEvent('event-2', 2),
      domainTaskEvent('event-3', 3),
    ])
    await eventStore.pruneBefore(3)
    await expect(client.events({ cursor: 'evt:1' }).next()).rejects.toMatchObject({
      name: 'SheClientError',
      code: 'cursor_expired',
    })
    const iterator = client.events({ cursor: 'evt:2' })[Symbol.asyncIterator]()
    const next = await iterator.next()
    expect(next.value).toMatchObject({ type: 'task', event: { cursor: 'evt:3' } })
    await iterator.return?.()
  })
})
