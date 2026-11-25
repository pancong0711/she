/** Reference bridge between a channel adapter and the SHE gateway.v1 client. */

import type { SheClient } from '@she/client'
import type {
  GatewayCommandResult,
  GatewayInboundEvent,
  GatewayInteractionResult,
  GatewayServerEvent,
  GatewayTaskEvent,
  RenderIntent,
  RenderTarget,
} from '@she/protocol'
import type { GatewayAdapter, GatewayInboundSink } from './index.js'

export interface SheGatewayBridgeOptions {
  readonly client: SheClient
  readonly adapter: GatewayAdapter
}

/**
 * Connects a channel adapter (feishu4dsh first) to SHE:
 *
 * - forwards inbound `/she` command invocations to `SheClient.command()`;
 * - forwards card/form interaction responses to `SheClient.interaction()`;
 * - renders immediate semantic RenderIntent results through the adapter;
 * - pumps the server event stream and forwards render/task events;
 * - leaves platform-specific Feishu/card/file handling in the adapter.
 *
 * The bridge does not own or close the client by default.
 */
export class SheGatewayBridge implements GatewayInboundSink {
  private abortController: AbortController | undefined
  private pumpPromise: Promise<void> | undefined
  private started = false

  constructor(private readonly options: SheGatewayBridgeOptions) {}

  /** Start the channel adapter and event-stream pump. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.options.adapter.start(this)
    this.abortController = new AbortController()
    this.pumpPromise = this.pumpEvents(this.abortController.signal)
  }

  /** Stop the event pump and channel adapter. The client remains caller-owned. */
  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    this.abortController?.abort()
    await this.pumpPromise?.catch(() => undefined)
    await this.options.adapter.stop()
    this.abortController = undefined
    this.pumpPromise = undefined
  }

  async onInbound(event: GatewayInboundEvent): Promise<void> {
    const target = this.targetOf(event)
    try {
      if (event.kind === 'command') {
        const result = await this.options.client.command(event)
        await this.renderCommandResult(target, result)
        return
      }
      if (event.kind === 'interaction') {
        const result = await this.options.client.interaction(event)
        await this.renderInteractionResult(target, result)
        return
      }
      await this.render(target, {
        kind: 'text',
        renderId: `${event.requestId}:unsupported`,
        sequence: 1,
        format: 'plain',
        text: 'This gateway message type is not supported by SHE v1.',
      })
    } catch (error) {
      await this.render(target, {
        kind: 'text',
        renderId: `${event.requestId}:error`,
        sequence: 1,
        format: 'plain',
        text: `SHE is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      }).catch(() => undefined)
    }
  }

  private async pumpEvents(signal: AbortSignal): Promise<void> {
    try {
      for await (const event of this.options.client.events({ signal })) {
        await this.handleServerEvent(event)
      }
    } catch (error) {
      if (signal.aborted) return
      // Reconnect/backoff is a gateway responsibility; expose the failure in
      // logs without creating a second state source.
      throw error
    }
  }

  private async handleServerEvent(event: GatewayServerEvent): Promise<void> {
    if (event.type === 'render') {
      await this.options.adapter.render(event.target, event.render)
      return
    }
    if (event.type === 'task') {
      await this.options.adapter.onTaskEvent?.(event.event)
    }
  }

  private async renderCommandResult(target: RenderTarget, result: GatewayCommandResult): Promise<void> {
    for (const intent of result.commandResult?.renderIntents ?? []) {
      await this.options.adapter.render(target, intent)
    }
  }

  private async renderInteractionResult(target: RenderTarget, result: GatewayInteractionResult): Promise<void> {
    for (const intent of result.commandResult?.renderIntents ?? []) {
      await this.options.adapter.render(target, intent)
    }
  }

  private async render(target: RenderTarget, intent: RenderIntent): Promise<void> {
    await this.options.adapter.render(target, intent)
  }

  private targetOf(event: GatewayInboundEvent): RenderTarget {
    return {
      conversation: event.conversation,
      ...(event.replyTo === undefined ? {} : { replyTo: event.replyTo }),
    }
  }
}

export type { GatewayTaskEvent }
