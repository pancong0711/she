/** OpenCode implementation of the SHE AgentAdapter contract. */

import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { AgentAdapter } from '@she/agent-sdk'
import type {
  AgentAdapterDescriptor,
  AgentEvent,
  AgentEventEnvelope,
  AgentHealth,
  AgentPromptRequest,
  AgentSessionRef,
  AgentSessionSpec,
  AgentSessionStatus,
  SheError,
} from '@she/protocol'
import { makeCapabilitySet, sheError } from '@she/protocol'
import {
  OpenCodeClient,
  OpenCodeError,
  type OpenCodeActiveSessions,
  type OpenCodeMessageInfo,
  type OpenCodeSessionInfo,
} from './client.js'
import { SHE_OPENCODE_PERMISSION_RULES, type OpenCodePermissionRule } from './permissions.js'

export interface OpenCodeAgentAdapterOptions {
  readonly baseUrl: string
  readonly username: string
  readonly credential: string
  readonly timeoutMs?: number
  readonly promptTimeoutMs?: number
  readonly pollIntervalMs?: number
  readonly maxReportBytes?: number
  readonly permissionRules?: readonly OpenCodePermissionRule[]
  readonly client?: OpenCodeClient
}

function lastAssistantTextOf(messages: readonly OpenCodeMessageInfo[]): string | undefined {
  for (const message of messages) {
    if (message.type !== 'assistant' || !Array.isArray(message.content)) continue
    const text = message.content
      .filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text ?? '')
      .join('\n')
      .trim()
    if (text !== '') return text
  }
  return undefined
}

function wait(ms: number): Promise<void> {
  return new Promise(resolvePromise => {
    const timer = setTimeout(resolvePromise, ms)
    timer.unref()
  })
}

function toSheError(error: unknown): SheError {
  if (error instanceof OpenCodeError) {
    const code = error.code === 'cancelled'
      ? 'cancelled'
      : error.code === 'timeout'
        ? 'timeout'
        : error.code === 'unauthorized'
          ? 'unauthorized'
          : error.code === 'not_found'
            ? 'not_found'
            : 'unavailable'
    return sheError(code, error.message, { retryable: error.code === 'unreachable' || error.code === 'http_error' })
  }
  return sheError('internal', error instanceof Error ? error.message : String(error), { retryable: true })
}

/**
 * OpenCode agent adapter.
 *
 * The current OpenCode HttpApi prompt endpoint is asynchronous: prompt returns
 * a message id immediately, then session outcome/messages are polled until a
 * terminal outcome is visible. This adapter converts that polling model into
 * the SHE AgentAdapter event stream.
 */
export class OpenCodeAgentAdapter implements AgentAdapter {
  readonly descriptor: AgentAdapterDescriptor = {
    adapterId: 'opencode',
    displayName: 'OpenCode',
    version: '0.1.0',
    capabilities: makeCapabilitySet([
      'agent.session.create',
      'agent.session.resume',
      'agent.session.dispose',
      'agent.prompt',
      'agent.cancel',
      'agent.event.stream',
      'agent.status',
      'agent.health',
    ]),
  }

  private readonly client: OpenCodeClient
  private readonly promptTimeoutMs: number
  private readonly pollIntervalMs: number
  private readonly maxReportBytes: number
  private readonly permissionRules: readonly OpenCodePermissionRule[]
  private readonly sessionDirectories = new Map<string, string>()

  constructor(options: OpenCodeAgentAdapterOptions) {
    this.client = options.client ?? new OpenCodeClient({
      baseUrl: options.baseUrl,
      username: options.username,
      credential: options.credential,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    this.promptTimeoutMs = options.promptTimeoutMs ?? 30 * 60_000
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000
    this.maxReportBytes = options.maxReportBytes ?? 2 * 1024 * 1024
    this.permissionRules = options.permissionRules ?? SHE_OPENCODE_PERMISSION_RULES
    if (this.pollIntervalMs < 1) throw new OpenCodeError('invalid_request', 'pollIntervalMs must be positive')
  }

  async health(): Promise<AgentHealth> {
    try {
      const info = await this.client.info()
      return {
        adapterId: this.descriptor.adapterId,
        ok: true,
        ...(info.version === undefined ? {} : { version: info.version }),
        checkedAt: Date.now(),
      }
    } catch (error) {
      return {
        adapterId: this.descriptor.adapterId,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now(),
      }
    }
  }

  async createSession(spec: AgentSessionSpec): Promise<AgentSessionRef> {
    const directory = spec.workspace.path
    if (directory === undefined || directory.trim() === '') {
      throw new OpenCodeError('invalid_request', 'OpenCode requires workspace.path')
    }
    const sessionId = await this.client.createSession({
      title: spec.metadata?.title ?? `SHE ${spec.sessionKey}`,
      directory,
      ...(spec.model === undefined ? {} : {
        model: {
          providerID: spec.model.providerId,
          id: spec.model.modelId,
          ...(spec.model.variant === undefined ? {} : { variant: spec.model.variant }),
        },
      }),
      permissions: this.permissionRules,
    })
    this.sessionDirectories.set(sessionId, directory)
    return {
      adapterId: this.descriptor.adapterId,
      sessionId,
      sessionKey: spec.sessionKey,
      workspace: spec.workspace,
      createdAt: Date.now(),
    }
  }

  async resumeSession(sessionId: string): Promise<AgentSessionRef> {
    const session = await this.client.getSession(sessionId)
    return {
      adapterId: this.descriptor.adapterId,
      sessionId: session.id,
      sessionKey: sessionId,
      workspace: { key: sessionId },
      createdAt: Date.now(),
    }
  }

  async *prompt(input: AgentPromptRequest): AsyncIterable<AgentEventEnvelope> {
    let sequence = 0
    const nextEvent = (event: AgentEvent): AgentEventEnvelope => {
      sequence += 1
      return {
        eventId: randomUUID(),
        sessionId: input.sessionId,
        sequence,
        emittedAt: Date.now(),
        event,
      }
    }

    const startedAt = Date.now()
    let emittedText = ''
    await this.client.prompt(input.sessionId, input.text)

    while (true) {
      if (input.signal?.aborted === true) {
        await this.client.interrupt(input.sessionId).catch(() => undefined)
        yield nextEvent({
          kind: 'turn-end',
          reason: 'cancelled',
          detail: 'prompt was cancelled by the caller',
        })
        return
      }
      if (Date.now() - startedAt > this.promptTimeoutMs) {
        await this.client.interrupt(input.sessionId).catch(() => undefined)
        const error = sheError('timeout', 'OpenCode prompt timed out', { retryable: true })
        yield nextEvent({ kind: 'error', error })
        yield nextEvent({ kind: 'turn-end', reason: 'error', detail: error.message })
        return
      }

      let session: OpenCodeSessionInfo
      let active: Awaited<ReturnType<OpenCodeClient['getActiveSessions']>>
      try {
        ;[session, active] = await Promise.all([
          this.client.getSession(input.sessionId),
          this.client.getActiveSessions().catch((): OpenCodeActiveSessions => ({})),
        ])
      } catch (error) {
        const mapped = toSheError(error)
        yield nextEvent({ kind: 'error', error: mapped })
        yield nextEvent({ kind: 'turn-end', reason: 'error', detail: mapped.message })
        return
      }

      const messages = await this.client.messages(input.sessionId).catch(() => [])
      const lastText = lastAssistantTextOf(messages)
      if (lastText !== undefined) {
        if (lastText.startsWith(emittedText)) {
          const delta = lastText.slice(emittedText.length)
          if (delta !== '') yield nextEvent({ kind: 'text-delta', text: delta })
        } else if (lastText !== emittedText) {
          yield nextEvent({ kind: 'text-delta', text: lastText })
        }
        emittedText = lastText
      }

      if (active[input.sessionId]?.type !== 'running') {
        if (session.outcome === 'succeeded' || session.outcome === 'failed' || session.outcome === 'interrupted') {
          const reportError = await this.validateReport(input)
          if (reportError !== undefined) {
            yield nextEvent({ kind: 'error', error: reportError })
            yield nextEvent({ kind: 'turn-end', reason: 'error', detail: reportError.message })
            return
          }
          if (session.outcome === 'succeeded') {
            yield nextEvent({ kind: 'turn-end', reason: 'completed' })
          } else if (session.outcome === 'interrupted') {
            yield nextEvent({ kind: 'turn-end', reason: 'cancelled', ...(lastText === undefined ? {} : { detail: lastText }) })
          } else {
            const error = sheError('internal', lastText ?? 'OpenCode session failed', { retryable: true })
            yield nextEvent({ kind: 'error', error })
            yield nextEvent({ kind: 'turn-end', reason: 'error', detail: error.message })
          }
          return
        }
      }
      await wait(this.pollIntervalMs)
    }
  }

  async cancel(sessionId: string, _reason?: string): Promise<void> {
    await this.client.interrupt(sessionId)
  }

  async status(sessionId: string): Promise<AgentSessionStatus> {
    const [session, active] = await Promise.all([
      this.client.getSession(sessionId),
      this.client.getActiveSessions().catch((): OpenCodeActiveSessions => ({})),
    ])
    if (active[sessionId]?.type === 'running') {
      return { sessionId, state: 'busy', lastActivityAt: Date.now() }
    }
    if (session.outcome === 'failed') return { sessionId, state: 'failed', lastActivityAt: Date.now() }
    return { sessionId, state: 'idle', lastActivityAt: Date.now() }
  }

  async dispose(_sessionId: string): Promise<void> {
    // OpenCode sessions are persistent; disposal is handled by explicit
    // control-plane policy rather than adapter teardown.
  }

  private async validateReport(input: AgentPromptRequest): Promise<SheError | undefined> {
    const reportPath = input.metadata?.reportPath
    if (reportPath === undefined || reportPath === '') return undefined
    const directory = this.sessionDirectories.get(input.sessionId)
    if (directory !== undefined) {
      const rel = relative(resolve(directory), resolve(reportPath))
      if (rel.startsWith('..') || isAbsolute(rel)) {
        return sheError('report_outside_workspace', 'report path must stay inside the session workspace')
      }
    }
    try {
      const info = await stat(reportPath)
      if (!info.isFile()) return sheError('report_missing', 'report path is not a regular file')
      if (info.size > this.maxReportBytes) {
        return sheError('report_too_large', `report exceeds ${String(this.maxReportBytes)} bytes`)
      }
      return undefined
    } catch {
      return sheError('report_missing', 'report file was not written')
    }
  }
}
