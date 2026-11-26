/** HTTP/JSON-over-Unix-socket gateway.v1 server for the SHE control plane. */

import { chmod, mkdir, readFile, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { ArtifactRepository, Clock, EventStore, SheDomainEvent, StoredEvent } from '@she/core'
import type {
  CapabilitySet,
  GatewayCommandInvocation,
  GatewayCommandRequest,
  GatewayCommandResult,
  GatewayHealth,
  GatewayHello,
  GatewayInteractionRequest,
  GatewayInteractionResult,
  GatewayServerEvent,
  GatewaySnapshot,
  GatewayWelcome,
  GatewayWorkerHealth,
  AgentRuntimeStatus,
  ArtifactListItem,
  SheError,
} from '@she/protocol'
import {
  CHANNEL_CAPABILITIES_V1,
  GATEWAY_PROTOCOL_VERSION,
  makeCapabilitySet,
  sheError,
} from '@she/protocol'

export interface ControlPlaneHandlers {
  command(command: GatewayCommandInvocation): Promise<GatewayCommandResult>
  interaction(input: GatewayInteractionRequest['interaction']): Promise<GatewayInteractionResult>
  snapshot(): Promise<GatewaySnapshot>
}

export type GatewayEventMapper = (stored: StoredEvent<SheDomainEvent>) => GatewayServerEvent | undefined

export interface ControlPlaneServerOptions {
  readonly socketPath: string
  readonly token?: string
  readonly serverVersion: string
  readonly capabilities?: CapabilitySet
  readonly handlers: ControlPlaneHandlers
  readonly eventStore: EventStore
  readonly eventMapper?: GatewayEventMapper
  readonly eventPollIntervalMs?: number
  readonly heartbeatIntervalMs?: number
  readonly eventBatchSize?: number
  readonly clock?: Clock
  readonly maxBodyBytes?: number
  readonly workerStatus?: () => Promise<GatewayWorkerHealth> | GatewayWorkerHealth
  readonly agentStatus?: () => Promise<AgentRuntimeStatus> | AgentRuntimeStatus
  readonly artifacts?: ArtifactRepository
  readonly artifactRoot?: string
  readonly requestShutdown?: () => void
}

export class ControlPlaneHttpError extends Error {
  readonly status: number
  readonly error: SheError

  constructor(status: number, error: SheError) {
    super(error.message)
    this.name = 'ControlPlaneHttpError'
    this.status = status
    this.error = error
  }
}

const SYSTEM_CLOCK: Clock = { now: () => Date.now() }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

function asSheError(error: unknown): SheError {
  if (error instanceof ControlPlaneHttpError) return error.error
  return sheError('internal', error instanceof Error ? error.message : String(error), { retryable: false })
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

function resultOk<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

function resultErr(error: SheError): { ok: false; error: SheError } {
  return { ok: false, error }
}

/**
 * Map persisted SHE domain events to gateway server events.
 *
 * Topic lifecycle events are intentionally not exposed to channel adapters in
 * v1; they can be added later as optional event types.
 */
export function mapDomainEventToGateway(stored: StoredEvent<SheDomainEvent>): GatewayServerEvent | undefined {
  const event = stored.event
  const base = {
    eventId: event.eventId,
    sequence: stored.sequence,
    cursor: stored.cursor,
    emittedAt: event.occurredAt,
  }
  if (event.aggregateType === 'task' && event.type === 'task.enqueued') {
    const payload = event.payload as {
      taskId: string
      topicId: string
      seq: number
      queuePosition: number
    }
    return {
      type: 'task',
      event: {
        ...base,
        type: 'task.accepted',
        taskId: payload.taskId,
        topicId: payload.topicId,
        taskRef: String(payload.seq),
        queuePosition: payload.queuePosition,
      },
    }
  }
  if (event.aggregateType === 'task' && event.type === 'task.status_changed') {
    const payload = event.payload as {
      taskId: string
      topicId: string
      from: string
      to: string
      reason?: string
      error?: { code: string; message: string; retryable?: boolean }
    }
    if (payload.to === 'succeeded') {
      return {
        type: 'task',
        event: {
          ...base,
          type: 'task.completed',
          taskId: payload.taskId,
          topicId: payload.topicId,
        },
      }
    }
    if (payload.to === 'failed' || payload.to === 'needs_attention' || payload.to === 'interrupted' || payload.to === 'cancelled') {
      const error = payload.error === undefined
        ? sheError(payload.to === 'cancelled' ? 'cancelled' : 'internal', payload.reason ?? `task ${payload.to}`, {
            retryable: payload.to === 'failed' || payload.to === 'needs_attention',
          })
        : sheError('internal', payload.error.message, {
            retryable: payload.error.retryable ?? false,
            details: { domainCode: payload.error.code },
          })
      return {
        type: 'task',
        event: {
          ...base,
          type: 'task.failed',
          taskId: payload.taskId,
          topicId: payload.topicId,
          error,
        },
      }
    }
    return {
      type: 'task',
      event: {
        ...base,
        type: 'task.progress',
        taskId: payload.taskId,
        topicId: payload.topicId,
        stage: payload.to,
        ...(payload.reason === undefined ? {} : { detail: payload.reason }),
      },
    }
  }
  if (event.aggregateType === 'task' && event.type === 'task.agent_event') {
    const payload = event.payload as {
      taskId: string
      topicId: string
      event:
        | { kind: 'text-delta'; text: string }
        | { kind: 'reasoning-delta'; text: string }
        | { kind: 'tool-call'; toolName: string; status: 'started' | 'completed' | 'failed'; detail?: string }
        | { kind: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
    }
    const agentEvent = payload.event
    if (agentEvent.kind === 'text-delta') {
      return {
        type: 'task',
        event: {
          ...base,
          type: 'agent.delta',
          taskId: payload.taskId,
          topicId: payload.topicId,
          text: agentEvent.text,
          channel: 'text',
        },
      }
    }
    if (agentEvent.kind === 'reasoning-delta') {
      return {
        type: 'task',
        event: {
          ...base,
          type: 'agent.delta',
          taskId: payload.taskId,
          topicId: payload.topicId,
          text: agentEvent.text,
          channel: 'reasoning',
        },
      }
    }
    if (agentEvent.kind === 'tool-call') {
      return {
        type: 'task',
        event: {
          ...base,
          type: 'tool.call',
          taskId: payload.taskId,
          topicId: payload.topicId,
          toolName: agentEvent.toolName,
          status: agentEvent.status,
          ...(agentEvent.detail === undefined ? {} : { detail: agentEvent.detail }),
        },
      }
    }
    return undefined
  }
  if (event.aggregateType === 'artifact' && event.type === 'artifact.created') {
    const payload = event.payload as {
      artifactId: string
      taskId: string
      kind: 'report' | 'output' | 'diff'
      fileName: string
      bytes: number
    }
    return {
      type: 'task',
      event: {
        ...base,
        type: 'artifact.created',
        taskId: payload.taskId,
        topicId: '',
        artifact: {
          id: payload.artifactId,
          fileName: payload.fileName,
          bytes: payload.bytes,
          taskId: payload.taskId,
        },
      },
    }
  }
  return undefined
}

/**
 * SHE control-plane gateway.v1 server.
 *
 * Transport: HTTP/JSON over a Unix domain socket; events are NDJSON.
 * The server is deliberately thin: task semantics are delegated to
 * `ControlPlaneHandlers`, while event replay/cursor rules stay here.
 */
export class ControlPlaneServer {
  private readonly socketPath: string
  private readonly token: string | undefined
  private readonly serverVersion: string
  private readonly capabilities: CapabilitySet
  private readonly handlers: ControlPlaneHandlers
  private readonly eventStore: EventStore
  private readonly eventMapper: GatewayEventMapper
  private readonly eventPollIntervalMs: number
  private readonly heartbeatIntervalMs: number
  private readonly eventBatchSize: number
  private readonly clock: Clock
  private readonly maxBodyBytes: number
  private readonly workerStatus: (() => Promise<GatewayWorkerHealth> | GatewayWorkerHealth) | undefined
  private readonly agentStatus: (() => Promise<AgentRuntimeStatus> | AgentRuntimeStatus) | undefined
  private readonly artifacts: ArtifactRepository | undefined
  private readonly artifactRoot: string | undefined
  private readonly requestShutdown: (() => void) | undefined
  private httpServer: Server | undefined
  private readonly streams = new Set<ServerResponse>()

  constructor(options: ControlPlaneServerOptions) {
    if (options.socketPath.trim() === '') throw new Error('socketPath must not be empty')
    this.socketPath = options.socketPath
    this.token = options.token
    this.serverVersion = options.serverVersion
    this.capabilities = options.capabilities ?? makeCapabilitySet(CHANNEL_CAPABILITIES_V1)
    this.handlers = options.handlers
    this.eventStore = options.eventStore
    this.eventMapper = options.eventMapper ?? mapDomainEventToGateway
    this.eventPollIntervalMs = options.eventPollIntervalMs ?? 500
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000
    this.eventBatchSize = options.eventBatchSize ?? 100
    this.clock = options.clock ?? SYSTEM_CLOCK
    this.maxBodyBytes = options.maxBodyBytes ?? 1_048_576
    this.workerStatus = options.workerStatus
    this.agentStatus = options.agentStatus
    this.artifacts = options.artifacts
    this.artifactRoot = options.artifactRoot
    this.requestShutdown = options.requestShutdown
    if (this.eventPollIntervalMs < 1) throw new Error('eventPollIntervalMs must be positive')
    if (this.eventBatchSize < 1) throw new Error('eventBatchSize must be positive')
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
    for (const stream of this.streams) stream.destroy()
    this.streams.clear()
    if (server !== undefined) {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    await unlink(this.socketPath).catch(() => undefined)
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!this.authorized(request)) {
        jsonWrite(response, 401, resultErr(sheError('unauthorized', 'missing or invalid bearer token')))
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        const worker = this.workerStatus === undefined ? undefined : await this.workerStatus()
        const health: GatewayHealth = {
          status: 'ok',
          service: 'she-control-plane',
          version: this.serverVersion,
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          capabilities: this.capabilities,
          checkedAt: this.clock.now(),
          ...(worker === undefined ? {} : { worker }),
        }
        jsonWrite(response, 200, health)
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/agents') {
        if (this.agentStatus === undefined) {
          jsonWrite(response, 404, resultErr(sheError('not_found', 'agent status is not configured')))
          return
        }
        jsonWrite(response, 200, resultOk(await this.agentStatus()))
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/shutdown') {
        if (this.requestShutdown === undefined) {
          jsonWrite(response, 503, resultErr(sheError('unavailable', 'shutdown callback is not configured')))
          return
        }
        jsonWrite(response, 200, resultOk({ shuttingDown: true }))
        this.requestShutdown()
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/artifacts') {
        if (this.artifacts === undefined) {
          jsonWrite(response, 404, resultErr(sheError('not_found', 'artifact store is not configured')))
          return
        }
        const taskId = url.searchParams.get('taskId')?.trim() ?? ''
        if (taskId === '') {
          jsonWrite(response, 400, resultErr(sheError('invalid_request', 'taskId query parameter is required')))
          return
        }
        const artifacts = await this.artifacts.listByTask(taskId)
        const value: ArtifactListItem[] = artifacts.map(artifact => ({
          id: artifact.id,
          fileName: artifact.fileName,
          bytes: artifact.bytes,
          sha256: artifact.sha256,
          taskId: artifact.taskId,
          downloadPath: `/v1/artifacts/${encodeURIComponent(artifact.id)}/download`,
        }))
        jsonWrite(response, 200, resultOk(value))
        return
      }
      if (request.method === 'GET' && /^\/v1\/artifacts\/[^/]+\/download$/.test(url.pathname)) {
        if (this.artifacts === undefined || this.artifactRoot === undefined) {
          jsonWrite(response, 404, resultErr(sheError('not_found', 'artifact download is not configured')))
          return
        }
        const artifactId = decodeURIComponent(url.pathname.split('/')[3] ?? '')
        const artifact = await this.artifacts.get(artifactId)
        if (artifact === undefined) {
          jsonWrite(response, 404, resultErr(sheError('not_found', `artifact not found: ${artifactId}`)))
          return
        }
        const storageRef = artifact.storageRef.replace(/\\/g, '/')
        const filePath = resolve(this.artifactRoot, storageRef)
        const rel = relative(resolve(this.artifactRoot), filePath)
        if (isAbsolute(storageRef) || rel.startsWith('..') || isAbsolute(rel)) {
          jsonWrite(response, 403, resultErr(sheError('forbidden', 'artifact storage path escapes the workspace')))
          return
        }
        try {
          const bytes = await readFile(filePath)
          response.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-length': bytes.byteLength,
            'content-disposition': `attachment; filename="${artifact.fileName.replace(/["\\\r\n]/g, '_')}"`,
            'cache-control': 'no-store',
          })
          response.end(bytes)
        } catch {
          jsonWrite(response, 404, resultErr(sheError('not_found', 'artifact file is missing')))
        }
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/hello') {
        const body = await this.readJson(request)
        const hello = body as GatewayHello
        if (!Array.isArray(hello.protocolVersions) || !hello.protocolVersions.includes(GATEWAY_PROTOCOL_VERSION)) {
          jsonWrite(response, 400, resultErr(sheError('protocol_mismatch', 'gateway.v1 is required')))
          return
        }
        const welcome: GatewayWelcome = {
          protocolVersion: GATEWAY_PROTOCOL_VERSION,
          serverVersion: this.serverVersion,
          capabilities: this.capabilities,
        }
        jsonWrite(response, 200, welcome)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        const body = await this.readJson(request) as Partial<GatewayCommandRequest>
        if (body.protocolVersion !== GATEWAY_PROTOCOL_VERSION || body.command === undefined) {
          jsonWrite(response, 400, resultErr(sheError('protocol_mismatch', 'invalid command request')))
          return
        }
        try {
          const value = await this.handlers.command(body.command)
          jsonWrite(response, 200, resultOk(value))
        } catch (error) {
          const typed = error instanceof ControlPlaneHttpError ? error : undefined
          jsonWrite(response, typed?.status ?? 500, resultErr(asSheError(error)))
        }
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/interactions') {
        const body = await this.readJson(request) as Partial<GatewayInteractionRequest>
        if (body.protocolVersion !== GATEWAY_PROTOCOL_VERSION || body.interaction === undefined) {
          jsonWrite(response, 400, resultErr(sheError('protocol_mismatch', 'invalid interaction request')))
          return
        }
        try {
          const value = await this.handlers.interaction(body.interaction)
          jsonWrite(response, 200, resultOk(value))
        } catch (error) {
          const typed = error instanceof ControlPlaneHttpError ? error : undefined
          jsonWrite(response, typed?.status ?? 500, resultErr(asSheError(error)))
        }
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/snapshot') {
        try {
          jsonWrite(response, 200, resultOk(await this.handlers.snapshot()))
        } catch (error) {
          jsonWrite(response, 500, resultErr(asSheError(error)))
        }
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/events') {
        await this.handleEvents(url, request, response)
        return
      }
      jsonWrite(response, 404, resultErr(sheError('not_found', `unknown endpoint: ${request.method ?? '?'} ${url.pathname}`)))
    } catch (error) {
      if (!response.headersSent) jsonWrite(response, 500, resultErr(asSheError(error)))
      else response.destroy()
    }
  }

  private async handleEvents(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const cursor = url.searchParams.get('cursor')
    if (cursor !== null) {
      let sequence: number
      try {
        sequence = Number(/^evt:([1-9][0-9]*)$/.exec(cursor)?.[1])
      } catch {
        sequence = NaN
      }
      if (!Number.isSafeInteger(sequence)) {
        jsonWrite(response, 400, resultErr(sheError('invalid_request', `invalid cursor: ${cursor}`)))
        return
      }
      const bounds = await this.eventStore.bounds()
      if (bounds.oldestSequence !== null && sequence < bounds.oldestSequence - 1) {
        jsonWrite(response, 409, resultErr(sheError('cursor_expired', 'event cursor is older than the replay window', {
          retryable: false,
          details: { cursor, oldestSequence: bounds.oldestSequence, newestSequence: bounds.newestSequence },
        })))
        return
      }
    }

    response.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    this.streams.add(response)
    let closed = false
    request.on('close', () => {
      closed = true
      this.streams.delete(response)
    })
    let currentCursor = cursor
    let lastWriteAt = this.clock.now()
    try {
      while (!closed && this.httpServer !== undefined) {
        const page = await this.eventStore.readAfter(currentCursor, this.eventBatchSize)
        for (const item of page.events) {
          currentCursor = item.cursor
          const mapped = this.eventMapper(item)
          if (mapped === undefined) continue
          response.write(`${JSON.stringify(mapped)}\n`)
          lastWriteAt = this.clock.now()
        }
        if (page.hasMore) continue
        if (this.clock.now() - lastWriteAt >= this.heartbeatIntervalMs) {
          const heartbeat: GatewayServerEvent = { type: 'heartbeat', at: this.clock.now() }
          response.write(`${JSON.stringify(heartbeat)}\n`)
          lastWriteAt = this.clock.now()
        }
        await wait(this.eventPollIntervalMs)
      }
    } finally {
      this.streams.delete(response)
      response.end()
    }
  }

  private authorized(request: IncomingMessage): boolean {
    if (this.token === undefined || this.token === '') return true
    return request.headers.authorization === `Bearer ${this.token}`
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk)
      size += buffer.byteLength
      if (size > this.maxBodyBytes) throw new ControlPlaneHttpError(413, sheError('invalid_request', 'request body too large'))
      chunks.push(buffer)
    }
    if (chunks.length === 0) throw new ControlPlaneHttpError(400, sheError('invalid_request', 'request body is required'))
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      throw new ControlPlaneHttpError(400, sheError('invalid_request', 'request body must be valid JSON'))
    }
  }
}
