import { describe, expect, it } from 'vitest'
import {
  AGENT_PROTOCOL_VERSION,
  CHANNEL_CAPABILITIES_V1,
  GATEWAY_V1_FIXTURES,
  GATEWAY_PROTOCOL_VERSION,
  type CardRenderIntent,
  type GatewayCommandResult,
  SANDBOX_PROTOCOL_VERSION,
  err,
  hasCapability,
  makeCapabilitySet,
  missingCapabilities,
  ok,
  sheError,
} from '@she/protocol'

describe('protocol common primitives', () => {
  it('exposes protocol v1 identifiers', () => {
    expect(GATEWAY_PROTOCOL_VERSION).toBe('gateway.v1')
    expect(AGENT_PROTOCOL_VERSION).toBe('agent.v1')
    expect(SANDBOX_PROTOCOL_VERSION).toBe('sandbox.v1')
  })

  it('normalizes and queries capability sets', () => {
    const capabilities = makeCapabilitySet(['file.outbound', 'text.outbound', 'text.outbound'])
    expect(capabilities.values).toEqual(['file.outbound', 'text.outbound'])
    expect(hasCapability(capabilities, 'text.outbound')).toBe(true)
    expect(hasCapability(capabilities, 'card.outbound')).toBe(false)
    expect(missingCapabilities(['card.outbound', 'text.outbound'], capabilities)).toEqual(['card.outbound'])
  })

  it('locks the canonical gateway.v1 channel capability names', () => {
    expect(CHANNEL_CAPABILITIES_V1).toEqual([
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
    ])
  })

  it('represents semantic cards and immediate command output', () => {
    const card: CardRenderIntent = {
      kind: 'card',
      renderId: 'render-1',
      sequence: 1,
      title: 'SHE status',
      blocks: [
        { type: 'text', text: 'control plane is healthy', format: 'markdown' },
        { type: 'fields', fields: [{ label: 'Tasks', value: '3 queued' }] },
      ],
      actions: [{ id: 'refresh', label: 'Refresh' }],
    }
    const result: GatewayCommandResult = {
      accepted: true,
      requestId: 'req-1',
      commandResult: { renderIntents: [card] },
    }
    expect(result.commandResult?.renderIntents[0]?.kind).toBe('card')
  })

  it('exposes stable gateway.v1 golden fixtures', () => {
    expect(GATEWAY_V1_FIXTURES.protocolVersion).toBe('gateway.v1')
    expect(GATEWAY_V1_FIXTURES.channelCapabilities).toHaveLength(13)
    expect(GATEWAY_V1_FIXTURES.commandResult.commandResult?.renderIntents).toHaveLength(2)
    expect(GATEWAY_V1_FIXTURES.messageRequest.message.kind).toBe('message')
    expect(GATEWAY_V1_FIXTURES.messageResult.taskId).toBe('task-fixture-1')
    expect(GATEWAY_V1_FIXTURES.serverEvent.type).toBe('task')
    expect(GATEWAY_V1_FIXTURES.snapshot.cursor).toBe('evt:1')
  })

  it('builds stable result and error values', () => {
    const failure = sheError('unavailable', 'control plane unavailable', {
      retryable: true,
      details: { socket: '/run/she.sock' },
    })
    expect(failure).toEqual({
      code: 'unavailable',
      message: 'control plane unavailable',
      retryable: true,
      details: { socket: '/run/she.sock' },
    })
    expect(ok(1)).toEqual({ ok: true, value: 1 })
    expect(err(failure)).toEqual({ ok: false, error: failure })
  })
})
