/** Common, transport-independent protocol types shared by all SHE protocols. */

export const GATEWAY_PROTOCOL_VERSION = 'gateway.v1' as const
export const AGENT_PROTOCOL_VERSION = 'agent.v1' as const
export const SANDBOX_PROTOCOL_VERSION = 'sandbox.v1' as const

export type ProtocolVersion =
  | typeof GATEWAY_PROTOCOL_VERSION
  | typeof AGENT_PROTOCOL_VERSION
  | typeof SANDBOX_PROTOCOL_VERSION

/** A set of named capabilities advertised during protocol handshake. */
export type Capability = string

export interface CapabilitySet {
  readonly values: readonly Capability[]
}

export function makeCapabilitySet(values: Iterable<Capability>): CapabilitySet {
  return { values: [...new Set(values)].sort() }
}

export function hasCapability(set: CapabilitySet, capability: Capability): boolean {
  return set.values.includes(capability)
}

export function missingCapabilities(required: Iterable<Capability>, available: CapabilitySet): readonly Capability[] {
  const present = new Set(available.values)
  return [...new Set(required)].filter(capability => !present.has(capability)).sort()
}

/** Namespaced extension bag for platform/adaptor-specific data. */
export type ExtensionBag = Readonly<Record<string, unknown>>

export interface ProtocolHello {
  readonly protocolVersions: readonly ProtocolVersion[]
  readonly clientVersion: string
  readonly capabilities: CapabilitySet
  readonly extensions?: ExtensionBag
}

export interface ProtocolWelcome {
  readonly protocolVersion: ProtocolVersion
  readonly serverVersion: string
  readonly capabilities: CapabilitySet
  readonly extensions?: ExtensionBag
}

export type ActorKind = 'user' | 'agent' | 'system' | 'service'

export interface ActorRef {
  readonly id: string
  readonly kind: ActorKind
  readonly displayName?: string
  readonly extensions?: ExtensionBag
}

export type ConversationKind = 'dm' | 'group' | 'thread' | 'cli' | 'api'

export interface ConversationRef {
  readonly id: string
  readonly kind: ConversationKind
  readonly parentId?: string
  readonly threadId?: string
  readonly extensions?: ExtensionBag
}

export interface ReplyContext {
  readonly messageId?: string
  readonly threadId?: string
  readonly parentMessageId?: string
}

export interface WorkspaceRef {
  /** Stable control-plane identifier for a workspace. */
  readonly key: string
  readonly displayName?: string
  /** Local absolute path; only valid for trusted, same-host adapters. */
  readonly path?: string
  readonly extensions?: ExtensionBag
}

export interface AttachmentRef {
  readonly id: string
  readonly fileName: string
  readonly mediaType?: string
  readonly bytes: number
  readonly sha256?: string
  readonly source?: 'upload' | 'artifact' | 'workspace'
  readonly extensions?: ExtensionBag
}

export interface ArtifactRef {
  readonly id: string
  readonly fileName: string
  readonly mediaType?: string
  readonly bytes: number
  readonly sha256?: string
  readonly taskId?: string
  readonly extensions?: ExtensionBag
}

export type SheErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'unauthorized'
  | 'forbidden'
  | 'unavailable'
  | 'timeout'
  | 'cancelled'
  | 'protocol_mismatch'
  | 'capability_missing'
  | 'cursor_expired'
  | 'report_missing'
  | 'report_too_large'
  | 'report_outside_workspace'
  | 'internal'

export interface SheError {
  readonly code: SheErrorCode
  readonly message: string
  readonly retryable: boolean
  readonly details?: Readonly<Record<string, unknown>>
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SheError }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<T = never>(error: SheError): Result<T> {
  return { ok: false, error }
}

export function sheError(
  code: SheErrorCode,
  message: string,
  options: { readonly retryable?: boolean; readonly details?: Readonly<Record<string, unknown>> } = {},
): SheError {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    ...(options.details === undefined ? {} : { details: options.details }),
  }
}

export interface RequestMeta {
  readonly requestId: string
  readonly actor: ActorRef
  readonly conversation: ConversationRef
  readonly idempotencyKey?: string
  readonly replyTo?: ReplyContext
  readonly extensions?: ExtensionBag
}
