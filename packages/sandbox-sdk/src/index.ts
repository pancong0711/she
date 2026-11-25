/** Public sandbox provider SDK. The broker daemon and future providers implement this. */

import type {
  SandboxEvent,
  SandboxMessageReceipt,
  SandboxMessageRequest,
  SandboxProviderHealth,
  SandboxSpec,
  SandboxStats,
  SandboxView,
} from '@she/protocol'

export interface SandboxProvider {
  health(): Promise<SandboxProviderHealth>
  list(): Promise<readonly SandboxView[]>
  inspect(name: string): Promise<SandboxView | undefined>
  create(spec: SandboxSpec): Promise<SandboxView>
  start(name: string): Promise<SandboxView>
  stop(name: string): Promise<SandboxView>
  restart(name: string): Promise<SandboxView>
  destroy(name: string, options: { readonly preserveData: boolean }): Promise<void>
  stats(name: string): Promise<SandboxStats | undefined>
  sendMessage(message: SandboxMessageRequest): Promise<SandboxMessageReceipt>
  subscribe(input: { readonly cursor?: string; readonly signal?: AbortSignal }): AsyncIterable<SandboxEvent>
}
