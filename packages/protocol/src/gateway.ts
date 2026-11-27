/** gateway protocol v1: channel adapters <-> SHE control plane. */

import type {
  ArtifactRef,
  AttachmentRef,
  CapabilitySet,
  ConversationRef,
  ExtensionBag,
  ProtocolHello,
  ProtocolVersion,
  ProtocolWelcome,
  ReplyContext,
  RequestMeta,
  SheError,
} from './common.js'
import { GATEWAY_PROTOCOL_VERSION } from './common.js'

export type GatewayProtocolVersion = typeof GATEWAY_PROTOCOL_VERSION

/** Canonical channel capability names for gateway.v1. Never rename existing names. */
export const CHANNEL_CAPABILITIES_V1 = [
  'text.inbound',
  'text.outbound',
  'markdown.outbound',
  'stream.outbound',
  'card.outbound',
  'form.outbound',
  'selector.outbound',
  'approval.interactive',
  'file.inbound',
  'file.outbound',
  'thread.reply',
  'mention',
  'reaction',
] as const

export type ChannelCapabilityV1 = (typeof CHANNEL_CAPABILITIES_V1)[number]
export type KnownGatewayCapability = ChannelCapabilityV1

export type GatewayCapability = KnownGatewayCapability | (string & {})

export interface GatewayHello extends ProtocolHello {
  readonly protocolVersions: readonly [GatewayProtocolVersion, ...ProtocolVersion[]]
}


export interface GatewayWelcome extends ProtocolWelcome {
  readonly protocolVersion: GatewayProtocolVersion
  readonly capabilities: CapabilitySet
}

export type InteractionValue = string | number | boolean | readonly string[]

export interface GatewayMessageEvent extends RequestMeta {
  readonly kind: 'message'
  readonly text: string
  readonly workspaceKey?: string
  readonly attachments?: readonly AttachmentRef[]
}

export interface GatewayCommandInvocation extends RequestMeta {
  readonly kind: 'command'
  /** Full command text, e.g. `/she sandbox list`. */
  readonly rawCommand: string
  readonly workspaceKey?: string
  readonly attachments?: readonly AttachmentRef[]
}

export interface GatewayInteractionResponse extends RequestMeta {
  readonly kind: 'interaction'
  readonly interactionId: string
  readonly values: Readonly<Record<string, InteractionValue>>
}

export type GatewayInboundEvent =
  | GatewayMessageEvent
  | GatewayCommandInvocation
  | GatewayInteractionResponse

export interface RenderTarget {
  readonly conversation: ConversationRef
  readonly replyTo?: ReplyContext
}

/** Request wrapper for an ordinary inbound message (no command semantics). */
export interface GatewayMessageRequest {
  readonly protocolVersion: GatewayProtocolVersion
  readonly message: GatewayMessageEvent
}

/**
 * Acknowledgement for an ordinary inbound message.
 *
 * A message is asynchronous: SHE returns once the task has been accepted and
 * emits further output through the event stream. The optional task/topic ids
 * let channel adapters correlate later task events with the original render
 * target, without owning any SHE business routing state.
 */
export interface GatewayMessageResult {
  readonly accepted: boolean
  readonly requestId: string
  readonly taskId?: string
  readonly topicId?: string
}

export interface RenderIntentBase {
  /** Stable identifier for one logical render target/stream. */
  readonly renderId: string
  readonly sequence: number
  readonly final?: boolean
  readonly extensions?: ExtensionBag
}

export interface TextRenderIntent extends RenderIntentBase {
  readonly kind: 'text'
  readonly format: 'plain' | 'markdown'
  readonly text: string
}

export interface ProgressRenderIntent extends RenderIntentBase {
  readonly kind: 'progress'
  readonly stage: string
  readonly label?: string
  readonly detail?: string
  readonly done?: boolean
}

export interface StatusRenderIntent extends RenderIntentBase {
  readonly kind: 'status'
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'attention'
  readonly label: string
  readonly detail?: string
}

export interface FormOption {
  readonly value: string
  readonly label: string
  readonly description?: string
}

export type FormField =
  | {
      readonly type: 'text'
      readonly id: string
      readonly label: string
      readonly required?: boolean
      readonly placeholder?: string
      readonly defaultValue?: string
    }
  | {
      readonly type: 'select'
      readonly id: string
      readonly label: string
      readonly required?: boolean
      readonly multiple?: boolean
      readonly options: readonly FormOption[]
    }

export interface FormRenderIntent extends RenderIntentBase {
  readonly kind: 'form'
  readonly interactionId: string
  readonly title: string
  readonly description?: string
  readonly fields: readonly FormField[]
  readonly submitLabel?: string
}

export interface ApprovalRenderIntent extends RenderIntentBase {
  readonly kind: 'approval'
  readonly interactionId: string
  readonly title: string
  readonly body?: string
  readonly approveLabel?: string
  readonly denyLabel?: string
  readonly timeoutMs?: number
}

export interface FileRenderIntent extends RenderIntentBase {
  readonly kind: 'file'
  readonly artifact: ArtifactRef
  readonly caption?: string
  /** Channel policy decides how approval is presented. */
  readonly approval?: 'channel-policy' | 'always' | 'never'
}

export interface CardTextBlock {
  readonly type: 'text'
  readonly text: string
  readonly format?: 'plain' | 'markdown'
}

export interface CardField {
  readonly label: string
  readonly value: string
}

export interface CardFieldsBlock {
  readonly type: 'fields'
  readonly fields: readonly CardField[]
}

export interface CardListItem {
  readonly id: string
  readonly primary: string
  readonly secondary?: string
  readonly selected?: boolean
}

export interface CardListBlock {
  readonly type: 'list'
  readonly items: readonly CardListItem[]
}

export interface CardDividerBlock {
  readonly type: 'divider'
}

export type CardBlock = CardTextBlock | CardFieldsBlock | CardListBlock | CardDividerBlock

export interface CardAction {
  readonly id: string
  readonly label: string
  readonly style?: 'default' | 'primary' | 'danger'
  readonly interactionId?: string
  readonly value?: string
}

/**
 * Platform-neutral semantic card. Gateway adapters decide how to render this
 * into Feishu/Lark card JSON or another platform's native widget.
 */
export interface CardRenderIntent extends RenderIntentBase {
  readonly kind: 'card'
  readonly title?: string
  readonly subtitle?: string
  readonly blocks: readonly CardBlock[]
  readonly actions?: readonly CardAction[]
}

export type RenderIntent =
  | TextRenderIntent
  | ProgressRenderIntent
  | StatusRenderIntent
  | FormRenderIntent
  | ApprovalRenderIntent
  | FileRenderIntent
  | CardRenderIntent

export interface GatewayTaskEventBase {
  readonly eventId: string
  readonly sequence: number
  readonly cursor: string
  readonly emittedAt: number
  readonly taskId: string
  readonly topicId: string
  readonly extensions?: ExtensionBag
}

export interface GatewayTaskAcceptedEvent extends GatewayTaskEventBase {
  readonly type: 'task.accepted'
  readonly taskRef: string
  readonly queuePosition: number
}

export interface GatewayTaskProgressEvent extends GatewayTaskEventBase {
  readonly type: 'task.progress'
  readonly stage: string
  readonly label?: string
  readonly detail?: string
}

export interface GatewayAgentDeltaEvent extends GatewayTaskEventBase {
  readonly type: 'agent.delta'
  readonly text: string
  readonly channel: 'text' | 'reasoning'
}

export interface GatewayToolCallEvent extends GatewayTaskEventBase {
  readonly type: 'tool.call'
  readonly toolName: string
  readonly status: 'started' | 'completed' | 'failed'
  readonly detail?: string
}

export interface GatewayApprovalRequestedEvent extends GatewayTaskEventBase {
  readonly type: 'approval.requested'
  readonly interactionId: string
  readonly title: string
  readonly body?: string
}

export interface GatewayArtifactCreatedEvent extends GatewayTaskEventBase {
  readonly type: 'artifact.created'
  readonly artifact: ArtifactRef
}

export interface GatewayTaskCompletedEvent extends GatewayTaskEventBase {
  readonly type: 'task.completed'
  readonly summary?: string
}

export interface GatewayTaskFailedEvent extends GatewayTaskEventBase {
  readonly type: 'task.failed'
  readonly error: SheError
}

export type GatewayTaskEvent =
  | GatewayTaskAcceptedEvent
  | GatewayTaskProgressEvent
  | GatewayAgentDeltaEvent
  | GatewayToolCallEvent
  | GatewayApprovalRequestedEvent
  | GatewayArtifactCreatedEvent
  | GatewayTaskCompletedEvent
  | GatewayTaskFailedEvent

export interface RenderServerEvent {
  readonly type: 'render'
  readonly target: RenderTarget
  readonly render: RenderIntent
}

export interface TaskServerEvent {
  readonly type: 'task'
  readonly event: GatewayTaskEvent
}

export interface HeartbeatServerEvent {
  readonly type: 'heartbeat'
  readonly at: number
}

export type GatewayServerEvent = RenderServerEvent | TaskServerEvent | HeartbeatServerEvent

export interface GatewayApi {
  hello(hello: GatewayHello): Promise<GatewayWelcome>
  invoke(event: GatewayInboundEvent): Promise<void>
  message?(message: GatewayMessageEvent): Promise<GatewayMessageResult>
  subscribe(input: { readonly cursor?: string; readonly signal?: AbortSignal }): AsyncIterable<GatewayServerEvent>
}

export interface GatewayWorkerHealth {
  readonly enabled: boolean
  readonly state: 'disabled' | 'idle' | 'running' | 'stopped' | 'error'
  readonly lastTaskId?: string
  readonly lastError?: string
  readonly updatedAt: number
}

export interface GatewayHealth {
  readonly status: 'ok' | 'degraded'
  readonly service: 'she-control-plane'
  readonly version: string
  readonly protocolVersion: GatewayProtocolVersion
  readonly capabilities: CapabilitySet
  readonly checkedAt: number
  readonly worker?: GatewayWorkerHealth
}

export interface GatewayCommandRequest {
  readonly protocolVersion: GatewayProtocolVersion
  readonly command: GatewayCommandInvocation
}

export interface GatewayCommandOutput {
  readonly renderIntents: readonly RenderIntent[]
}

export interface GatewayCommandResult {
  readonly accepted: boolean
  readonly requestId: string
  readonly taskId?: string
  readonly topicId?: string
  /** Immediate semantic output for read-only commands; write commands use the event stream. */
  readonly commandResult?: GatewayCommandOutput
}

export interface GatewayInteractionRequest {
  readonly protocolVersion: GatewayProtocolVersion
  readonly interaction: GatewayInteractionResponse
}

export interface GatewayInteractionResult {
  readonly accepted: boolean
  readonly interactionId: string
  readonly commandResult?: GatewayCommandOutput
}

export interface GatewayTaskSnapshot {
  readonly taskId: string
  readonly topicId: string
  readonly seq: number
  readonly status: string
  readonly priority: string
  readonly risk: string
  readonly excerpt: string
  readonly agentSessionId?: string
  readonly sandboxName?: string
  readonly error?: SheError
  readonly createdAt: number
  readonly updatedAt: number
  readonly startedAt?: number
  readonly finishedAt?: number
}

/**
 * Read-only snapshot used when an event cursor has expired or a gateway needs
 * to rebuild task state after reconnecting.
 */
export interface ArtifactListItem extends ArtifactRef {
  /** Safe local control-plane download path. */
  readonly downloadPath: string
}

export interface GatewaySnapshot {
  readonly protocolVersion: GatewayProtocolVersion
  readonly generatedAt: number
  readonly cursor: string | null
  readonly tasks: readonly GatewayTaskSnapshot[]
}
