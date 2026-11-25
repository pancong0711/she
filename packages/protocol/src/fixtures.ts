/**
 * Versioned protocol golden fixtures.
 *
 * Both SHE and gateway adapters (feishu4dsh first) should import these typed
 * samples in their contract tests instead of maintaining hand-copied shapes.
 */

import type {
  GatewayCommandRequest,
  GatewayCommandResult,
  GatewayServerEvent,
  GatewayTaskEvent,
  RenderIntent,
} from './gateway.js'
import { GATEWAY_PROTOCOL_VERSION } from './common.js'
import { CHANNEL_CAPABILITIES_V1 } from './gateway.js'

export const GATEWAY_V1_COMMAND_REQUEST: GatewayCommandRequest = {
  protocolVersion: GATEWAY_PROTOCOL_VERSION,
  command: {
    kind: 'command',
    requestId: 'req-fixture-1',
    idempotencyKey: 'idem-fixture-1',
    actor: { id: 'user-fixture', kind: 'user', displayName: 'Fixture User' },
    conversation: { id: 'chat-fixture', kind: 'dm' },
    rawCommand: '/she status',
  },
}

export const GATEWAY_V1_RENDER_INTENTS: readonly RenderIntent[] = [
  {
    kind: 'text',
    renderId: 'render-fixture-text',
    sequence: 1,
    format: 'markdown',
    text: 'SHE is healthy.',
  },
  {
    kind: 'card',
    renderId: 'render-fixture-card',
    sequence: 1,
    title: 'SHE status',
    blocks: [
      { type: 'fields', fields: [{ label: 'Tasks', value: '3 queued' }] },
      { type: 'text', text: 'Control plane is **healthy**.', format: 'markdown' },
    ],
    actions: [{ id: 'refresh', label: 'Refresh' }],
  },
]

export const GATEWAY_V1_COMMAND_RESULT: GatewayCommandResult = {
  accepted: true,
  requestId: 'req-fixture-1',
  commandResult: { renderIntents: GATEWAY_V1_RENDER_INTENTS },
}

export const GATEWAY_V1_TASK_EVENT: GatewayTaskEvent = {
  type: 'task.accepted',
  eventId: 'event-fixture-1',
  sequence: 1,
  cursor: 'evt:1',
  emittedAt: 1_700_000_000_000,
  taskId: 'task-fixture-1',
  topicId: 'topic-fixture-1',
  taskRef: '1.1',
  queuePosition: 1,
}

export const GATEWAY_V1_SERVER_EVENT: GatewayServerEvent = {
  type: 'task',
  event: GATEWAY_V1_TASK_EVENT,
}

/**
 * Canonical fixture set. Keep this object additive and versioned; consumers
 * must not depend on implementation-private test files.
 */
export const GATEWAY_V1_FIXTURES = {
  protocolVersion: GATEWAY_PROTOCOL_VERSION,
  channelCapabilities: CHANNEL_CAPABILITIES_V1,
  commandRequest: GATEWAY_V1_COMMAND_REQUEST,
  commandResult: GATEWAY_V1_COMMAND_RESULT,
  renderIntents: GATEWAY_V1_RENDER_INTENTS,
  taskEvent: GATEWAY_V1_TASK_EVENT,
  serverEvent: GATEWAY_V1_SERVER_EVENT,
} as const
