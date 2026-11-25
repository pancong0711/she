/** HTTP/JSON-over-Unix-socket server for the SHE sandbox broker. */

import { chmod, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type {
  CapabilitySet,
  SandboxBrokerHealth,
  SandboxMessageRequest,
  SandboxSpec,
} from '@she/protocol'
import { SANDBOX_PROTOCOL_VERSION, makeCapabilitySet, sheError } from '@she/protocol'
import { BrokerError, brokerErrorStatus } from './errors.js'
import type { SandboxBrokerService } from './service.js'

export interface BrokerServerOptions {
  readonly socketPath: string
  readonly service: SandboxBrokerService
  readonly token?: string
  readonly brokerVersion: string
  readonly capabilities?: CapabilitySet
  readonly maxBodyBytes?: number
}

function resultOk<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

function resultErr(message: string, code: 'invalid_request' | 'not_found' | 'forbidden' | 'unavailable' = 'invalid_request', status = 400): { status: number; body: unknown } {
  return {
    status,
    body: {
      ok: false,
      error: sheError(code, message, { retryable: code === 'unavailable' }),
    },
  }
}

function jsonWrite(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBodyBytes) throw new BrokerError('too_large', 'request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BrokerError('invalid_request', 'request body must be a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw error instanceof BrokerError ? error : new BrokerError('invalid_request', 'invalid JSON body')
  }
}

/**
 * Broker HTTP API. It never exposes a generic Docker endpoint: every route maps
 * to a fixed broker operation and policy check.
 */
export class BrokerServer {
  private readonly socketPath: string
  private readonly service: SandboxBrokerService
  private readonly token: string | undefined
  private readonly brokerVersion: string
  private readonly capabilities: CapabilitySet
  private readonly maxBodyBytes: number
  private httpServer: Server | undefined

  constructor(options: BrokerServerOptions) {
    if (options.socketPath.trim() === '') throw new Error('socketPath must not be empty')
    this.socketPath = options.socketPath
    this.service = options.service
    this.token = options.token
    this.brokerVersion = options.brokerVersion
    this.capabilities = options.capabilities ?? makeCapabilitySet([
      'sandbox.create', 'sandbox.start', 'sandbox.stop', 'sandbox.restart',
      'sandbox.destroy', 'sandbox.inspect', 'sandbox.stats', 'sandbox.message',
      'sandbox.registry', 'sandbox.audit',
    ])
    this.maxBodyBytes = options.maxBodyBytes ?? 20 * 1024 * 1024
  }

  async start(): Promise<void> {
    if (this.httpServer !== undefined) return
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 })
    await chmod(dirname(this.socketPath), 0o700).catch(() => undefined)
    await unlink(this.socketPath).catch(() => undefined)
    const server = createServer((request, response) => {
      void this.handle(request, response)
    })
    this.httpServer = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => resolve())
    })
    await chmod(this.socketPath, 0o600)
  }

  async close(): Promise<void> {
    const server = this.httpServer
    this.httpServer = undefined
    if (server !== undefined) await new Promise<void>(resolve => server.close(() => resolve()))
    await unlink(this.socketPath).catch(() => undefined)
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (this.token !== undefined && this.token !== '' && request.headers.authorization !== `Bearer ${this.token}`) {
        jsonWrite(response, 401, resultErr('missing or invalid bearer token', 'forbidden', 401).body)
        return
      }
      const url = new URL(request.url ?? '/', 'http://broker.local')
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        const health = await this.service.health()
        const payload: SandboxBrokerHealth = {
          status: health.ok ? 'ok' : 'degraded',
          provider: 'she-broker',
          version: this.brokerVersion,
          protocolVersion: SANDBOX_PROTOCOL_VERSION,
          capabilities: this.capabilities,
          checkedAt: health.checkedAt,
        }
        jsonWrite(response, 200, payload)
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/sandboxes') {
        jsonWrite(response, 200, resultOk(await this.service.list()))
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/sandboxes') {
        const body = await readJson(request, this.maxBodyBytes)
        jsonWrite(response, 201, resultOk(await this.service.create(body as unknown as SandboxSpec)))
        return
      }
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (parts[0] === 'v1' && parts[1] === 'sandboxes' && parts[2] !== undefined) {
        const name = parts[2]
        if (parts.length === 3 && request.method === 'GET') {
          const sandbox = await this.service.inspect(name)
          if (sandbox === undefined) {
            jsonWrite(response, 404, resultErr(`sandbox not found: ${name}`, 'not_found', 404).body)
          } else {
            jsonWrite(response, 200, resultOk(sandbox))
          }
          return
        }
        if (parts.length === 3 && request.method === 'DELETE') {
          const preserveData = url.searchParams.get('preserveData') !== 'false'
          await this.service.destroy(name, { preserveData })
          jsonWrite(response, 200, resultOk(null))
          return
        }
        if (parts.length === 4 && parts[3] === 'stats' && request.method === 'GET') {
          jsonWrite(response, 200, resultOk(await this.service.stats(name) ?? null))
          return
        }
        if (parts.length === 4 && parts[3] === 'start' && request.method === 'POST') {
          jsonWrite(response, 200, resultOk(await this.service.start(name)))
          return
        }
        if (parts.length === 4 && parts[3] === 'stop' && request.method === 'POST') {
          jsonWrite(response, 200, resultOk(await this.service.stop(name)))
          return
        }
        if (parts.length === 4 && parts[3] === 'restart' && request.method === 'POST') {
          jsonWrite(response, 200, resultOk(await this.service.restart(name)))
          return
        }
        if (parts.length === 4 && parts[3] === 'messages' && request.method === 'POST') {
          const body = await readJson(request, this.maxBodyBytes)
          const message: SandboxMessageRequest = {
            ...(body as unknown as SandboxMessageRequest),
            to: name,
          }
          jsonWrite(response, 201, resultOk(await this.service.sendMessage(message)))
          return
        }
      }
      jsonWrite(response, 404, resultErr('not found', 'not_found', 404).body)
    } catch (error) {
      if (error instanceof BrokerError) {
        jsonWrite(response, brokerErrorStatus(error), {
          ok: false,
          error: sheError(error.code === 'unavailable' ? 'unavailable' : error.code === 'not_found' ? 'not_found' : error.code === 'forbidden' ? 'forbidden' : 'invalid_request', error.message, {
            retryable: error.code === 'unavailable' || error.code === 'docker_failed',
            details: { brokerCode: error.code },
          }),
        })
        return
      }
      jsonWrite(response, 500, {
        ok: false,
        error: sheError('internal', error instanceof Error ? error.message : String(error)),
      })
    }
  }
}
