/** sandbox protocol v1: SHE control plane <-> sandbox providers/broker. */

import type {
  ArtifactRef,
  CapabilitySet,
  ExtensionBag,
  ProtocolHello,
  ProtocolVersion,
  ProtocolWelcome,
} from './common.js'
import { SANDBOX_PROTOCOL_VERSION } from './common.js'

export type SandboxProtocolVersion = typeof SANDBOX_PROTOCOL_VERSION

export type KnownSandboxCapability =
  | 'sandbox.create'
  | 'sandbox.start'
  | 'sandbox.stop'
  | 'sandbox.restart'
  | 'sandbox.destroy'
  | 'sandbox.inspect'
  | 'sandbox.stats'
  | 'sandbox.message'
  | 'sandbox.registry'
  | 'sandbox.audit'
  | 'sandbox.host-mount'
  | 'sandbox.command'
  | 'sandbox.exec'

export type SandboxCapability = KnownSandboxCapability | (string & {})

export interface SandboxHello extends ProtocolHello {
  readonly protocolVersions: readonly [SandboxProtocolVersion, ...ProtocolVersion[]]
}

export interface SandboxWelcome extends ProtocolWelcome {
  readonly protocolVersion: SandboxProtocolVersion
  readonly capabilities: CapabilitySet
}

export type SandboxRole = 'standalone' | 'main' | 'worker' | 'observer' | 'utility'
export type SandboxNetworkMode = 'none' | 'egress'
export type SandboxStatus = 'pending' | 'running' | 'stopped' | 'failed' | 'destroyed' | 'unknown'

export interface SandboxResources {
  readonly cpus?: number
  readonly memoryMb?: number
  readonly pids?: number
}

/**
 * A host directory explicitly mounted into a sandbox.
 *
 * Host mounts are intentionally coarse and target-constrained: users can
 * replace the sandbox workspace, expose one legacy directory read-only, or
 * mirror a directory under the sandbox agent home. The broker resolves and
 * validates every source with realpath before Docker sees it.
 */
export type SandboxHostMountTarget =
  | { readonly kind: 'workspace' }
  | { readonly kind: 'legacy' }
  | { readonly kind: 'home'; readonly path: string }

export interface SandboxHostMount {
  /** Absolute host path. Root, critical system directories and home itself are rejected. */
  readonly source: string
  readonly target: SandboxHostMountTarget
  /** Defaults to true. Workspace mounts are normally read-write. */
  readonly readOnly?: boolean
}

export interface SandboxSpec {
  readonly name: string
  readonly role: SandboxRole
  readonly agentId: string
  readonly image: string
  readonly networkMode: SandboxNetworkMode
  readonly resources?: SandboxResources
  readonly allowedCallers?: readonly string[]
  readonly allowedTargets?: readonly string[]
  readonly maxDelegationDepth?: number
  readonly labels?: Readonly<Record<string, string>>
  readonly extensions?: ExtensionBag
  /** Optional command executed inside the container after the image. */
  readonly command?: readonly string[]
  /**
   * Explicit host directory mounts, validated by the broker. When no
   * workspace mount is supplied, `/workspace` is a sandbox-local scratch
   * directory; it is not a user project workspace.
   */
  readonly hostMounts?: readonly SandboxHostMount[]
}

export interface SandboxExecRequest {
  /** argv passed to `docker exec`; never interpreted by the host shell. */
  readonly command: readonly string[]
  /** Absolute container path under an allowed writable/read-only root. Defaults to /workspace (scratch unless a workspace host mount is configured). */
  readonly cwd?: string
  /** Hard timeout; defaults to 30s and is capped by the broker. */
  readonly timeoutMs?: number
}

export interface SandboxExecResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
  readonly timedOut: boolean
  readonly startedAt: number
  readonly finishedAt: number
}

export interface SandboxView {
  readonly name: string
  readonly role: SandboxRole
  readonly agentId: string
  readonly status: SandboxStatus
  readonly image?: string
  readonly imageDigest?: string
  readonly createdAt?: number
  readonly startedAt?: number
  readonly health?: 'ok' | 'degraded' | 'unknown'
  readonly labels?: Readonly<Record<string, string>>
}

export interface SandboxStats {
  readonly name: string
  readonly cpuPercent?: number
  readonly memoryBytes?: number
  readonly memoryLimitBytes?: number
  readonly pids?: number
  readonly networkRxBytes?: number
  readonly networkTxBytes?: number
  readonly collectedAt: number
}

export interface SandboxArtifactInput {
  readonly fromSandbox: string
  /** Relative path inside the sender's outbox. */
  readonly fromOutbox: string
  readonly as: string
}

export interface SandboxMessageRequest {
  readonly messageId: string
  readonly from: string
  readonly to: string
  readonly rootTaskId: string
  readonly parentTaskId?: string
  readonly handoffDepth?: number
  readonly text?: string
  readonly artifacts?: readonly SandboxArtifactInput[]
  readonly createdAt: number
  readonly expiresAt?: number
  readonly extensions?: ExtensionBag
}

export interface SandboxMessageReceipt {
  readonly messageId: string
  readonly accepted: boolean
  readonly manifestPath?: string
  readonly artifacts: readonly ArtifactRef[]
}

export interface SandboxProviderHealth {
  readonly providerId: string
  readonly ok: boolean
  readonly detail?: string
  readonly checkedAt: number
}

export interface SandboxEventBase {
  readonly eventId: string
  readonly sandboxName: string
  readonly emittedAt: number
  readonly extensions?: ExtensionBag
}

export type SandboxEvent =
  | (SandboxEventBase & { readonly type: 'sandbox.created' })
  | (SandboxEventBase & { readonly type: 'sandbox.started' })
  | (SandboxEventBase & { readonly type: 'sandbox.stopped' })
  | (SandboxEventBase & { readonly type: 'sandbox.failed'; readonly error: string })
  | (SandboxEventBase & { readonly type: 'sandbox.destroyed' })
  | (SandboxEventBase & { readonly type: 'message.delivered'; readonly messageId: string })

export interface SandboxApi {
  hello(hello: SandboxHello): Promise<SandboxWelcome>
  health(): Promise<SandboxProviderHealth>
  list(): Promise<readonly SandboxView[]>
  inspect(name: string): Promise<SandboxView | undefined>
  create(spec: SandboxSpec): Promise<SandboxView>
  start(name: string): Promise<SandboxView>
  stop(name: string): Promise<SandboxView>
  restart(name: string): Promise<SandboxView>
  destroy(name: string, options: { readonly preserveData: boolean }): Promise<void>
  stats(name: string): Promise<SandboxStats | undefined>
  exec(name: string, request: SandboxExecRequest): Promise<SandboxExecResult>
  sendMessage(message: SandboxMessageRequest): Promise<SandboxMessageReceipt>
  subscribe(input: { readonly cursor?: string; readonly signal?: AbortSignal }): AsyncIterable<SandboxEvent>
}

export interface SandboxBrokerHealth {
  readonly status: 'ok' | 'degraded'
  readonly provider: 'she-broker'
  readonly version: string
  readonly protocolVersion: SandboxProtocolVersion
  readonly capabilities: CapabilitySet
  readonly checkedAt: number
}
