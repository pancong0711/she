/** agent protocol v1: SHE control plane <-> agent adapters. */

import type {
  AttachmentRef,
  CapabilitySet,
  ExtensionBag,
  ProtocolHello,
  ProtocolVersion,
  ProtocolWelcome,
  SheError,
  WorkspaceRef,
} from './common.js'
import { AGENT_PROTOCOL_VERSION } from './common.js'

export type AgentProtocolVersion = typeof AGENT_PROTOCOL_VERSION

export type KnownAgentCapability =
  | 'agent.session.create'
  | 'agent.session.resume'
  | 'agent.session.dispose'
  | 'agent.prompt'
  | 'agent.cancel'
  | 'agent.event.stream'
  | 'agent.status'
  | 'agent.health'

export type AgentCapability = KnownAgentCapability | (string & {})

export interface AgentHello extends ProtocolHello {
  readonly protocolVersions: readonly [AgentProtocolVersion, ...ProtocolVersion[]]
}

export interface AgentWelcome extends ProtocolWelcome {
  readonly protocolVersion: AgentProtocolVersion
  readonly capabilities: CapabilitySet
}

export interface AgentModelRef {
  readonly providerId: string
  readonly modelId: string
  readonly variant?: string
  readonly effort?: string
}

export interface AgentSessionSpec {
  readonly adapterId: string
  readonly sessionKey: string
  readonly workspace: WorkspaceRef
  readonly model?: AgentModelRef
  readonly metadata?: Readonly<Record<string, string>>
  readonly extensions?: ExtensionBag
}

export interface AgentSessionRef {
  readonly adapterId: string
  readonly sessionId: string
  readonly sessionKey: string
  readonly workspace: WorkspaceRef
  readonly createdAt: number
}

export type AgentSessionState = 'starting' | 'ready' | 'busy' | 'idle' | 'failed' | 'closed'

export interface AgentSessionStatus {
  readonly sessionId: string
  readonly state: AgentSessionState
  readonly lastActivityAt?: number
  readonly detail?: string
  readonly extensions?: ExtensionBag
}

export interface AgentPromptRequest {
  readonly promptId: string
  readonly sessionId: string
  readonly text: string
  readonly attachments?: readonly AttachmentRef[]
  readonly idempotencyKey?: string
  /** Adapter-defined scalar metadata (for example `reportPath`). */
  readonly metadata?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  readonly extensions?: ExtensionBag
}

export type AgentEventKind = 'text-delta' | 'reasoning-delta' | 'tool-call' | 'usage' | 'turn-end' | 'error'

export interface AgentTextDeltaEvent {
  readonly kind: 'text-delta'
  readonly text: string
  readonly messageId?: string
}

export interface AgentReasoningDeltaEvent {
  readonly kind: 'reasoning-delta'
  readonly text: string
}

export interface AgentToolCallEvent {
  readonly kind: 'tool-call'
  readonly toolName: string
  readonly status: 'started' | 'completed' | 'failed'
  readonly detail?: string
}

export interface AgentUsageEvent {
  readonly kind: 'usage'
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
}

export interface AgentTurnEndEvent {
  readonly kind: 'turn-end'
  readonly reason: 'completed' | 'cancelled' | 'error' | 'max-tokens'
  readonly detail?: string
}

export interface AgentErrorEvent {
  readonly kind: 'error'
  readonly error: SheError
}

export type AgentEvent =
  | AgentTextDeltaEvent
  | AgentReasoningDeltaEvent
  | AgentToolCallEvent
  | AgentUsageEvent
  | AgentTurnEndEvent
  | AgentErrorEvent

export interface AgentEventEnvelope {
  readonly eventId: string
  readonly sessionId: string
  readonly sequence: number
  readonly emittedAt: number
  readonly event: AgentEvent
  readonly extensions?: ExtensionBag
}

export interface AgentHealth {
  readonly adapterId: string
  readonly ok: boolean
  readonly version?: string
  readonly detail?: string
  readonly checkedAt: number
}

export interface AgentAdapterDescriptor {
  readonly adapterId: string
  readonly displayName: string
  readonly version: string
  readonly capabilities: CapabilitySet
  readonly extensions?: ExtensionBag
}

export interface AgentApi {
  hello(hello: AgentHello): Promise<AgentWelcome>
  createSession(spec: AgentSessionSpec): Promise<AgentSessionRef>
  resumeSession(sessionId: string): Promise<AgentSessionRef>
  prompt(input: AgentPromptRequest): AsyncIterable<AgentEventEnvelope>
  cancel(sessionId: string, reason?: string): Promise<void>
  status(sessionId: string): Promise<AgentSessionStatus>
  dispose(sessionId: string): Promise<void>
  health(): Promise<AgentHealth>
}
