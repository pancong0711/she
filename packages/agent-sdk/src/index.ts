/** Public agent-adapter SDK. Implemented by OpenCode, dsh and future harness adapters. */

import type {
  AgentAdapterDescriptor,
  AgentEventEnvelope,
  AgentHealth,
  AgentPromptRequest,
  AgentSessionRef,
  AgentSessionSpec,
  AgentSessionStatus,
} from '@she/protocol'

export interface AgentAdapter {
  readonly descriptor: AgentAdapterDescriptor
  health(): Promise<AgentHealth>
  createSession(spec: AgentSessionSpec): Promise<AgentSessionRef>
  resumeSession(sessionId: string): Promise<AgentSessionRef>
  prompt(input: AgentPromptRequest): AsyncIterable<AgentEventEnvelope>
  cancel(sessionId: string, reason?: string): Promise<void>
  status(sessionId: string): Promise<AgentSessionStatus>
  dispose(sessionId: string): Promise<void>
}
