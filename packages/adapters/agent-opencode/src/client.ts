/** Minimal OpenCode HttpApi client pinned to the verified 2.x route shapes. */

export interface OpenCodeClientOptions {
  readonly baseUrl: string
  readonly username: string
  readonly credential: string
  readonly timeoutMs?: number
}

export interface OpenCodeSessionInfo {
  readonly id: string
  readonly title?: string
  readonly outcome?: 'succeeded' | 'failed' | 'interrupted'
  readonly time?: { readonly busy?: number; readonly idle?: number }
}

export interface OpenCodeActiveSessions {
  readonly [sessionId: string]: { readonly type?: string }
}

export interface OpenCodeMessageInfo {
  readonly type?: string
  readonly content?: readonly { readonly type?: string; readonly text?: string }[]
}

export interface OpenCodeCreateSessionInput {
  readonly title: string
  readonly directory: string
  readonly model?: { readonly providerID: string; readonly id: string; readonly variant?: string }
  readonly permissions: readonly { readonly action: string; readonly resource: string; readonly effect: 'allow' | 'deny' | 'ask' }[]
}

interface ApiEnvelope<T> {
  readonly data: T
}

export type OpenCodeErrorCode =
  | 'unauthorized'
  | 'unreachable'
  | 'not_found'
  | 'http_error'
  | 'invalid_response'
  | 'invalid_request'
  | 'timeout'
  | 'cancelled'

export class OpenCodeError extends Error {
  readonly code: OpenCodeErrorCode
  readonly status: number | undefined

  constructor(code: OpenCodeErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'OpenCodeError'
    this.code = code
    this.status = status
  }
}

function basicAuth(username: string, credential: string): string {
  return `Basic ${Buffer.from(`${username}:${credential}`, 'utf8').toString('base64')}`
}

export class OpenCodeClient {
  private readonly baseUrl: string
  private readonly authorization: string
  private readonly timeoutMs: number

  constructor(options: OpenCodeClientOptions) {
    if (options.baseUrl.trim() === '') throw new OpenCodeError('invalid_request', 'baseUrl must not be empty')
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.authorization = basicAuth(options.username, options.credential)
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async info(): Promise<{ readonly version?: string }> {
    return this.request<{ version?: string }>('GET', '/api/info')
  }

  async getSession(sessionId: string): Promise<OpenCodeSessionInfo> {
    const response = await this.request<ApiEnvelope<OpenCodeSessionInfo>>(
      'GET',
      `/api/session/${encodeURIComponent(sessionId)}`,
    )
    if (response.data === undefined || typeof response.data.id !== 'string') {
      throw new OpenCodeError('invalid_response', 'OpenCode session response has no id')
    }
    return response.data
  }

  async getActiveSessions(): Promise<OpenCodeActiveSessions> {
    const response = await this.request<ApiEnvelope<OpenCodeActiveSessions>>('GET', '/api/session/active')
    return response.data ?? {}
  }

  async createSession(input: OpenCodeCreateSessionInput): Promise<string> {
    const response = await this.request<ApiEnvelope<OpenCodeSessionInfo>>('POST', '/api/session', {
      title: input.title,
      ...(input.model === undefined ? {} : { model: input.model }),
      location: { directory: input.directory },
      permissions: input.permissions,
    })
    if (response.data === undefined || typeof response.data.id !== 'string') {
      throw new OpenCodeError('invalid_response', 'OpenCode create-session response has no id')
    }
    return response.data.id
  }

  async prompt(sessionId: string, text: string): Promise<string> {
    const response = await this.request<ApiEnvelope<{ id?: string }>>(
      'POST',
      `/api/session/${encodeURIComponent(sessionId)}/prompt`,
      { text, delivery: 'queue' },
    )
    if (response.data === undefined || typeof response.data.id !== 'string') {
      throw new OpenCodeError('invalid_response', 'OpenCode prompt response has no message id')
    }
    return response.data.id
  }

  async messages(sessionId: string): Promise<readonly OpenCodeMessageInfo[]> {
    const response = await this.request<{ data?: OpenCodeMessageInfo[] }>(
      'GET',
      `/api/session/${encodeURIComponent(sessionId)}/message?limit=20&order=desc`,
    )
    return Array.isArray(response.data) ? response.data : []
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.request<{ interrupted?: boolean }>(
      'POST',
      `/api/session/${encodeURIComponent(sessionId)}/interrupt`,
    )
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: this.authorization,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new OpenCodeError(
        'unreachable',
        `OpenCode service unreachable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (response.status === 401) throw new OpenCodeError('unauthorized', 'OpenCode authentication failed', 401)
    if (response.status === 404) throw new OpenCodeError('not_found', 'OpenCode resource not found', 404)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new OpenCodeError('http_error', `OpenCode HTTP ${response.status}: ${text.slice(0, 300)}`, response.status)
    }
    if (response.status === 204) return undefined as T
    try {
      return await response.json() as T
    } catch {
      throw new OpenCodeError('invalid_response', 'OpenCode returned a non-JSON response', response.status)
    }
  }
}
