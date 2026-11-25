/** Public channel-adapter SDK. Implemented by gateway adapters such as feishu4dsh. */

import type {
  CapabilitySet,
  ExtensionBag,
  GatewayInboundEvent,
  RenderIntent,
  RenderTarget,
} from '@she/protocol'

export interface GatewayAdapterDescriptor {
  readonly adapterId: string
  readonly displayName: string
  readonly version: string
  readonly capabilities: CapabilitySet
  readonly extensions?: ExtensionBag
}

export interface GatewayInboundSink {
  onInbound(event: GatewayInboundEvent): Promise<void>
}

export interface RenderReceipt {
  readonly renderId: string
  readonly sequence: number
  readonly deliveredAt: number
  readonly messageId?: string
}

export interface GatewayAdapter {
  readonly descriptor: GatewayAdapterDescriptor
  start(sink: GatewayInboundSink): Promise<void>
  render(target: RenderTarget, intent: RenderIntent): Promise<RenderReceipt>
  stop(): Promise<void>
}
