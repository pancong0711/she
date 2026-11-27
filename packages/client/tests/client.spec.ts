import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GATEWAY_PROTOCOL_VERSION,
  makeCapabilitySet,
  type GatewayCommandInvocation,
  type GatewayInteractionResponse,
} from '@she/protocol'
import { SheClient, SheClientError } from '@she/client'

type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void

const cleanup: (() => Promise<void>)[] = []

async function startServer(handler: Handler): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'she-client-'))
  const socketPath = join(dir, 'control.sock')
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      handler(request, response, Buffer.concat(chunks).toString('utf8'))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  cleanup.push(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })
  return socketPath
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

const command: GatewayCommandInvocation = {
  kind: 'command',
  requestId: 'req-1',
  actor: { id: 'user-1', kind: 'user' },
  conversation: { id: 'chat-1', kind: 'dm' },
  rawCommand: '/she status task-1',
  idempotencyKey: 'idem-1',
}

const interaction: GatewayInteractionResponse = {
  kind: 'interaction',
  requestId: 'req-2',
  actor: { id: 'user-1', kind: 'user' },
  conversation: { id: 'chat-1', kind: 'dm' },
  interactionId: 'interaction-1',
  values: { choice: 'approve' },
}

describe('@she/client', () => {
  it('performs health and hello handshake over a Unix socket', async () => {
    let authorization: string | undefined
    const socketPath = await startServer((request, response, body) => {
      authorization = typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined
      if (request.url === '/v1/health') {
        json(response, 200, {
          status: 'ok',
          service: 'she-control-plane',
          version: '0.1.0',
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          capabilities: makeCapabilitySet(['text.inbound', 'text.outbound']),
          checkedAt: 1,
        })
        return
      }
      if (request.url === '/v1/hello' && request.method === 'POST') {
        const hello = JSON.parse(body) as { clientVersion: string }
        expect(hello.clientVersion).toBe('0.1.1')
        json(response, 200, {
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          serverVersion: '0.1.0',
          capabilities: makeCapabilitySet(['text.inbound', 'text.outbound']),
        })
        return
      }
      json(response, 404, { code: 'not_found', message: 'not found', retryable: false })
    })

    const client = new SheClient({ socketPath, token: 'secret-token' })
    const health = await client.health()
    const welcome = await client.hello()
    expect(authorization).toBe('Bearer secret-token')
    expect(health.protocolVersion).toBe('gateway.v1')
    expect(welcome.serverVersion).toBe('0.1.0')
    await client.close()
  })

  it('unwraps command and interaction results', async () => {
    const socketPath = await startServer((request, response, body) => {
      if (request.url === '/v1/commands') {
        const payload = JSON.parse(body) as { protocolVersion: string; command: { requestId: string } }
        expect(payload.protocolVersion).toBe('gateway.v1')
        json(response, 200, {
          ok: true,
          value: { accepted: true, requestId: payload.command.requestId, taskId: 'task-1' },
        })
        return
      }
      if (request.url === '/v1/interactions') {
        const payload = JSON.parse(body) as { interaction: { interactionId: string } }
        json(response, 200, {
          ok: true,
          value: { accepted: true, interactionId: payload.interaction.interactionId },
        })
        return
      }
      json(response, 404, { code: 'not_found', message: 'not found', retryable: false })
    })

    const client = new SheClient({ socketPath })
    const commandResult = await client.command(command)
    const interactionResult = await client.interaction(interaction)
    expect(commandResult.taskId).toBe('task-1')
    expect(interactionResult.interactionId).toBe('interaction-1')
    await client.close()
  })

  it('parses NDJSON server events', async () => {
    const socketPath = await startServer((request, response) => {
      expect(request.url).toBe('/v1/events?protocolVersion=gateway.v1&cursor=evt%3A7')
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      response.write(`${JSON.stringify({ type: 'heartbeat', at: 1 })}\n`)
      response.end(`${JSON.stringify({ type: 'heartbeat', at: 2 })}\n`)
    })

    const client = new SheClient({ socketPath })
    const events = []
    for await (const event of client.events({ cursor: 'evt:7' })) events.push(event)
    expect(events).toEqual([
      { type: 'heartbeat', at: 1 },
      { type: 'heartbeat', at: 2 },
    ])
  })

  it('converts structured server errors and transport failures', async () => {
    const socketPath = await startServer((_request, response) => {
      json(response, 503, {
        ok: false,
        error: { code: 'unavailable', message: 'control plane busy', retryable: true },
      })
    })

    const client = new SheClient({ socketPath })
    await expect(client.command(command)).rejects.toMatchObject({
      name: 'SheClientError',
      code: 'unavailable',
      retryable: true,
    })

    const missing = new SheClient({ socketPath: join(tmpdir(), 'definitely-missing-she.sock') })
    await expect(missing.health()).rejects.toBeInstanceOf(SheClientError)
    await client.close()
    await expect(client.events().next()).rejects.toMatchObject({ code: 'cancelled' })
  })
})
