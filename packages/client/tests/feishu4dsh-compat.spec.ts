import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CHANNEL_CAPABILITIES_V1,
  GATEWAY_PROTOCOL_VERSION,
  GATEWAY_V1_FIXTURES,
  makeCapabilitySet,
  type ArtifactListItem,
  type GatewayServerEvent,
} from '@she/protocol'
import { SheClient } from '@she/client'

const cleanup: Array<() => Promise<void>> = []

async function fakeSheServer(handler: (request: IncomingMessage, response: ServerResponse, body: string) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'she-feishu4dsh-compat-'))
  const socketPath = join(dir, 'control.sock')
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => handler(request, response, Buffer.concat(chunks).toString('utf8')))
  })
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(socketPath, () => resolvePromise())
  })
  cleanup.push(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })
  return socketPath
}

function json(response: ServerResponse, payload: unknown, status = 200): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

describe('feishu4dsh gateway.v1 compatibility surface', () => {
  it('supports health/hello, command, interaction, events, artifact list and download', async () => {
    const report = '# SHE task report\n\n- task: task-1\n\nfeishu-ok\n'
    const artifact: ArtifactListItem = {
      id: 'artifact-1',
      taskId: 'task-1',
      fileName: 'task-1.md',
      mediaType: 'text/markdown',
      bytes: Buffer.byteLength(report),
      sha256: 'a'.repeat(64),
      downloadPath: '/v1/artifacts/artifact-1/download',
    }
    const taskEvent: GatewayServerEvent = {
      type: 'task',
      event: {
        ...GATEWAY_V1_FIXTURES.taskEvent,
        type: 'artifact.created',
        taskId: 'task-1',
        topicId: 'topic-1',
        artifact,
      },
    }
    const socketPath = await fakeSheServer((request, response, body) => {
      if (request.method === 'GET' && request.url === '/v1/health') {
        json(response, {
          status: 'ok',
          service: 'she-control-plane',
          version: '0.3.1',
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          capabilities: makeCapabilitySet(CHANNEL_CAPABILITIES_V1),
          checkedAt: 1,
        })
        return
      }
      if (request.method === 'POST' && request.url === '/v1/hello') {
        const hello = JSON.parse(body) as { protocolVersions: readonly string[] }
        expect(hello.protocolVersions).toContain(GATEWAY_PROTOCOL_VERSION)
        json(response, {
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          serverVersion: '0.3.1',
          capabilities: makeCapabilitySet(CHANNEL_CAPABILITIES_V1),
        })
        return
      }
      if (request.method === 'POST' && request.url === '/v1/commands') {
        const payload = JSON.parse(body) as { command: { requestId: string } }
        json(response, {
          ok: true,
          value: {
            accepted: true,
            requestId: payload.command.requestId,
            taskId: 'task-1',
            topicId: 'topic-1',
            commandResult: { renderIntents: GATEWAY_V1_FIXTURES.renderIntents },
          },
        })
        return
      }
      if (request.method === 'POST' && request.url === '/v1/interactions') {
        const payload = JSON.parse(body) as { interaction: { interactionId: string } }
        json(response, { ok: true, value: { accepted: true, interactionId: payload.interaction.interactionId } })
        return
      }
      if (request.method === 'GET' && request.url?.startsWith('/v1/events')) {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' })
        response.end(`${JSON.stringify(taskEvent)}\n`)
        return
      }
      if (request.method === 'GET' && request.url === '/v1/artifacts?taskId=task-1') {
        json(response, { ok: true, value: [artifact] })
        return
      }
      if (request.method === 'GET' && request.url === '/v1/artifacts/artifact-1/download') {
        response.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-length': Buffer.byteLength(report),
          'content-disposition': 'attachment; filename="task-1.md"',
        })
        response.end(report)
        return
      }
      json(response, { ok: false, error: { code: 'not_found', message: 'missing', retryable: false } }, 404)
    })

    const client = new SheClient({ socketPath, capabilities: CHANNEL_CAPABILITIES_V1 })
    const health = await client.health()
    const welcome = await client.hello()
    expect(health.protocolVersion).toBe(GATEWAY_PROTOCOL_VERSION)
    expect(welcome.capabilities.values).toContain('file.outbound')

    const command = await client.command(GATEWAY_V1_FIXTURES.commandRequest.command)
    expect(command.taskId).toBe('task-1')
    expect(command.commandResult?.renderIntents.length).toBeGreaterThan(0)

    const interaction = await client.interaction({
      kind: 'interaction',
      requestId: 'req-interaction',
      actor: { id: 'user-fixture', kind: 'user' },
      conversation: { id: 'chat-fixture', kind: 'dm' },
      interactionId: 'interaction-1',
      values: { decision: 'approve' },
    })
    expect(interaction.interactionId).toBe('interaction-1')

    const events: GatewayServerEvent[] = []
    for await (const event of client.events({ cursor: 'evt:1' })) events.push(event)
    expect(events[0]).toMatchObject({ type: 'task', event: { type: 'artifact.created', taskId: 'task-1' } })

    const artifacts = await client.artifacts('task-1')
    expect(artifacts).toEqual([artifact])
    const download = await client.downloadArtifact('artifact-1')
    expect(Buffer.from(download.bytes).toString('utf8')).toContain('feishu-ok')
    expect(download.contentType).toContain('text/markdown')
    expect(download.contentDisposition).toContain('task-1.md')
    await client.close()
  })
})
