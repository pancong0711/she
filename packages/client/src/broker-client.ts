/** Thin client for the SHE sandbox broker Unix-socket API. */

import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import type {
  Result,
  SandboxBrokerHealth,
  SandboxExecRequest,
  SandboxExecResult,
  SandboxMessageReceipt,
  SandboxMessageRequest,
  SandboxSpec,
  SandboxStats,
  SandboxView,
  SheError,
} from '@she/protocol'
import { SheClientError } from './errors.js'

export interface SandboxBrokerClientOptions {
  readonly socketPath: string
  readonly token?: string
  readonly timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSheError(value: unknown): value is SheError {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string' && typeof value.retryable === 'boolean'
}

function unwrapResult<T>(payload: unknown, fallback: string): T {
  if (!isRecord(payload) || typeof payload.ok !== 'boolean') {
    throw new SheClientError('internal', `invalid broker response: ${fallback}`)
  }
  if (!payload.ok) {
    if (isSheError(payload.error)) {
      throw new SheClientError(payload.error.code, payload.error.message, {
        retryable: payload.error.retryable,
        ...(payload.error.details === undefined ? {} : { details: payload.error.details }),
      })
    }
    throw new SheClientError('internal', `invalid broker error: ${fallback}`)
  }
  return payload.value as T
}

export class SandboxBrokerClient {
  private readonly socketPath: string
  private readonly token: string | undefined
  private readonly timeoutMs: number

  constructor(options: SandboxBrokerClientOptions) {
    if (options.socketPath.trim() === '') throw new SheClientError('invalid_request', 'socketPath must not be empty')
    this.socketPath = options.socketPath
    this.token = options.token
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async health(): Promise<SandboxBrokerHealth> {
    return this.requestJson<SandboxBrokerHealth>('GET', '/v1/health')
  }

  async list(): Promise<readonly SandboxView[]> {
    return unwrapResult(await this.requestJson<unknown>('GET', '/v1/sandboxes'), 'list')
  }

  async inspect(name: string): Promise<SandboxView | undefined> {
    try {
      return unwrapResult<SandboxView>(await this.requestJson<unknown>('GET', `/v1/sandboxes/${encodeURIComponent(name)}`), 'inspect')
    } catch (error) {
      if (error instanceof SheClientError && error.code === 'not_found') return undefined
      throw error
    }
  }

  async create(spec: SandboxSpec): Promise<SandboxView> {
    return unwrapResult(await this.requestJson<unknown>('POST', '/v1/sandboxes', spec), 'create')
  }

  async start(name: string): Promise<SandboxView> {
    return unwrapResult(await this.requestJson<unknown>('POST', `/v1/sandboxes/${encodeURIComponent(name)}/start`), 'start')
  }

  async stop(name: string): Promise<SandboxView> {
    return unwrapResult(await this.requestJson<unknown>('POST', `/v1/sandboxes/${encodeURIComponent(name)}/stop`), 'stop')
  }

  async restart(name: string): Promise<SandboxView> {
    return unwrapResult(await this.requestJson<unknown>('POST', `/v1/sandboxes/${encodeURIComponent(name)}/restart`), 'restart')
  }

  async destroy(name: string, options: { readonly preserveData: boolean } = { preserveData: true }): Promise<void> {
    unwrapResult(await this.requestJson<unknown>(
      'DELETE',
      `/v1/sandboxes/${encodeURIComponent(name)}?preserveData=${String(options.preserveData)}`,
    ), 'destroy')
  }

  async stats(name: string): Promise<SandboxStats | undefined> {
    const value = unwrapResult<SandboxStats | null>(
      await this.requestJson<unknown>('GET', `/v1/sandboxes/${encodeURIComponent(name)}/stats`),
      'stats',
    )
    return value ?? undefined
  }

  async exec(name: string, request: SandboxExecRequest): Promise<SandboxExecResult> {
    return unwrapResult(
      await this.requestJson<unknown>('POST', `/v1/sandboxes/${encodeURIComponent(name)}/exec`, request),
      'exec',
    )
  }

  async sendMessage(message: SandboxMessageRequest): Promise<SandboxMessageReceipt> {
    return unwrapResult(
      await this.requestJson<unknown>('POST', `/v1/sandboxes/${encodeURIComponent(message.to)}/messages`, message),
      'sendMessage',
    )
  }

  private async requestJson<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
    const headers: Record<string, string> = { accept: 'application/json' }
    if (payload !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(payload.byteLength)
    }
    if (this.token !== undefined && this.token !== '') headers.authorization = `Bearer ${this.token}`
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request: ClientRequest = httpRequest({
        socketPath: this.socketPath,
        path,
        method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      }, resolve)
      request.on('error', error => reject(new SheClientError('transport_error', `cannot reach SHE broker: ${error.message}`, {
        retryable: true,
        details: { socketPath: this.socketPath },
      })))
      if (payload !== undefined) request.write(payload)
      request.end()
    })
    const chunks: Buffer[] = []
    for await (const chunk of response) chunks.push(Buffer.from(chunk))
    const text = Buffer.concat(chunks).toString('utf8')
    let parsed: unknown
    try {
      parsed = text === '' ? undefined : JSON.parse(text)
    } catch {
      throw new SheClientError('internal', 'invalid JSON response from SHE broker')
    }
    if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
      if (isRecord(parsed) && isSheError(parsed.error)) {
        throw new SheClientError(parsed.error.code, parsed.error.message, {
          retryable: parsed.error.retryable,
          ...(parsed.error.details === undefined ? {} : { details: parsed.error.details }),
        })
      }
      throw new SheClientError('unavailable', `SHE broker returned HTTP ${String(response.statusCode)}`, { retryable: true })
    }
    return parsed as T
  }
}
