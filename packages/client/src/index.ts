/** Thin, dependency-free client for the SHE control-plane gateway.v1 API. */

import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import type {
  GatewayCommandRequest,
  GatewayCommandResult,
  GatewayHealth,
  GatewayHello,
  GatewayInteractionRequest,
  GatewayInteractionResult,
  GatewayServerEvent,
  GatewaySnapshot,
  GatewayWelcome,
  Result,
  SheError,
} from '@she/protocol'
import { SHE_CLIENT_VERSION, SheClientError, type SheClientErrorCode } from './errors.js'
import {
  CHANNEL_CAPABILITIES_V1,
  GATEWAY_PROTOCOL_VERSION,
  makeCapabilitySet,
} from '@she/protocol'

export { SHE_CLIENT_VERSION, SheClientError } from './errors.js'
export type { SheClientErrorCode } from './errors.js'

export interface SheClientOptions {
  readonly socketPath: string
  readonly token?: string
  readonly clientVersion?: string
  readonly capabilities?: readonly string[]
  readonly timeoutMs?: number
}

export interface SubscribeOptions {
  readonly cursor?: string
  readonly signal?: AbortSignal
}

type JsonObject = Record<string, unknown>

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSheError(value: unknown): value is SheError {
  if (!isRecord(value)) return false
  return (
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean'
  )
}

function errorFromPayload(payload: unknown, fallbackCode: SheClientErrorCode, fallbackMessage: string): SheClientError {
  if (isRecord(payload) && payload.ok === false && isSheError(payload.error)) {
    return new SheClientError(payload.error.code, payload.error.message, {
      retryable: payload.error.retryable,
      ...(payload.error.details === undefined ? {} : { details: payload.error.details }),
    })
  }
  if (isRecord(payload) && isSheError(payload)) {
    return new SheClientError(payload.code, payload.message, {
      retryable: payload.retryable,
      ...(payload.details === undefined ? {} : { details: payload.details }),
    })
  }
  return new SheClientError(fallbackCode, fallbackMessage)
}

function unwrapResult<T>(payload: unknown, fallbackMessage: string): T {
  if (!isRecord(payload) || typeof payload.ok !== 'boolean') {
    throw new SheClientError('internal', `invalid response: ${fallbackMessage}`)
  }
  if (!payload.ok) throw errorFromPayload(payload, 'internal', fallbackMessage)
  return payload.value as T
}

export class SheClient {
  private readonly socketPath: string
  private readonly token: string | undefined
  private readonly clientVersion: string
  private readonly capabilities: readonly string[]
  private readonly timeoutMs: number
  private closed = false

  constructor(options: SheClientOptions) {
    if (options.socketPath.trim() === '') throw new SheClientError('invalid_request', 'socketPath must not be empty')
    this.socketPath = options.socketPath
    this.token = options.token
    this.clientVersion = options.clientVersion ?? SHE_CLIENT_VERSION
    this.capabilities = options.capabilities ?? CHANNEL_CAPABILITIES_V1
    this.timeoutMs = options.timeoutMs ?? 30_000
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1) {
      throw new SheClientError('invalid_request', 'timeoutMs must be a positive number')
    }
  }

  get endpoint(): string {
    return this.socketPath
  }

  async health(signal?: AbortSignal): Promise<GatewayHealth> {
    return this.requestJson<GatewayHealth>('GET', '/v1/health', undefined, signal)
  }

  async hello(input?: Partial<GatewayHello>): Promise<GatewayWelcome> {
    const hello: GatewayHello = {
      protocolVersions: input?.protocolVersions ?? [GATEWAY_PROTOCOL_VERSION],
      clientVersion: input?.clientVersion ?? this.clientVersion,
      capabilities: input?.capabilities ?? makeCapabilitySet(this.capabilities),
      ...(input?.extensions === undefined ? {} : { extensions: input.extensions }),
    }
    return this.requestJson<GatewayWelcome>('POST', '/v1/hello', hello)
  }

  async command(command: GatewayCommandRequest['command'], signal?: AbortSignal): Promise<GatewayCommandResult> {
    const body: GatewayCommandRequest = { protocolVersion: GATEWAY_PROTOCOL_VERSION, command }
    const response = await this.requestJson<unknown>('POST', '/v1/commands', body, signal)
    return unwrapResult<GatewayCommandResult>(response, 'command failed')
  }

  async interaction(
    interaction: GatewayInteractionRequest['interaction'],
    signal?: AbortSignal,
  ): Promise<GatewayInteractionResult> {
    const body: GatewayInteractionRequest = { protocolVersion: GATEWAY_PROTOCOL_VERSION, interaction }
    const response = await this.requestJson<unknown>('POST', '/v1/interactions', body, signal)
    return unwrapResult<GatewayInteractionResult>(response, 'interaction failed')
  }

  async snapshot(signal?: AbortSignal): Promise<GatewaySnapshot> {
    const response = await this.requestJson<unknown>('GET', '/v1/snapshot', undefined, signal)
    return unwrapResult<GatewaySnapshot>(response, 'snapshot failed')
  }

  async *events(options: SubscribeOptions = {}): AsyncIterable<GatewayServerEvent> {
    this.assertOpen()
    const query = new URLSearchParams({ protocolVersion: GATEWAY_PROTOCOL_VERSION })
    if (options.cursor !== undefined) query.set('cursor', options.cursor)
    const response = await this.openRequest(
      'GET',
      `/v1/events?${query.toString()}`,
      undefined,
      options.signal,
    )
    if (response.statusCode !== undefined && response.statusCode >= 400) {
      const chunks: Buffer[] = []
      for await (const chunk of response) chunks.push(Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString('utf8')
      let payload: unknown
      try {
        payload = text === '' ? undefined : JSON.parse(text)
      } catch {
        payload = undefined
      }
      throw errorFromPayload(
        payload,
        'unavailable',
        `SHE control plane returned HTTP ${response.statusCode}`,
      )
    }
    let buffer = ''
    try {
      for await (const chunk of response) {
        buffer += chunk.toString('utf8')
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line !== '') yield this.parseEvent(line)
          newline = buffer.indexOf('\n')
        }
      }
      const tail = buffer.trim()
      if (tail !== '') yield this.parseEvent(tail)
    } finally {
      response.destroy()
    }
  }

  async close(): Promise<void> {
    this.closed = true
  }

  private parseEvent(line: string): GatewayServerEvent {
    try {
      return JSON.parse(line) as GatewayServerEvent
    } catch {
      throw new SheClientError('internal', 'invalid NDJSON event from SHE control plane')
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new SheClientError('cancelled', 'SHE client is closed')
  }

  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.openRequest(method, path, body, signal)
    const chunks: Buffer[] = []
    for await (const chunk of response) chunks.push(Buffer.from(chunk))
    const text = Buffer.concat(chunks).toString('utf8')
    if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
      let payload: unknown
      try {
        payload = text === '' ? undefined : JSON.parse(text)
      } catch {
        payload = undefined
      }
      throw errorFromPayload(
        payload,
        'unavailable',
        `SHE control plane returned HTTP ${response.statusCode ?? 'unknown'}`,
      )
    }
    if (text === '') throw new SheClientError('internal', 'empty JSON response from SHE control plane')
    try {
      return JSON.parse(text) as T
    } catch {
      throw new SheClientError('internal', 'invalid JSON response from SHE control plane')
    }
  }

  private async openRequest(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<IncomingMessage> {
    this.assertOpen()
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
    const headers: Record<string, string> = {
      accept: path.startsWith('/v1/events') ? 'application/x-ndjson' : 'application/json',
    }
    if (payload !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(payload.byteLength)
    }
    if (this.token !== undefined && this.token !== '') headers.authorization = `Bearer ${this.token}`

    const timeout = AbortSignal.timeout(this.timeoutMs)
    const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])

    return await new Promise<IncomingMessage>((resolve, reject) => {
      const req: ClientRequest = httpRequest(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers,
          signal: requestSignal,
        },
        response => {
          if (response.statusCode !== undefined && response.statusCode >= 400) {
            // The JSON body is handled by the caller; return the response so it can
            // produce a structured error from the server payload.
            resolve(response)
            return
          }
          resolve(response)
        },
      )
      req.on('error', error => {
        const message = error instanceof Error ? error.message : String(error)
        reject(new SheClientError('transport_error', `cannot reach SHE control plane: ${message}`, {
          retryable: true,
          details: { socketPath: this.socketPath },
        }))
      })
      if (payload !== undefined) req.write(payload)
      req.end()
    })
  }
}

export type { GatewayCommandResult, GatewayInteractionResult, GatewayServerEvent, Result, SheError }
export * from './broker-client.js'
