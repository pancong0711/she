/**
 * Versioned protocol golden fixtures.
 *
 * Both SHE and gateway adapters (feishu4dsh first) should import these typed
 * samples in their contract tests instead of maintaining hand-copied shapes.
 */

import type {
  GatewayCommandRequest,
  GatewayCommandResult,
  GatewayMessageRequest,
  GatewayMessageResult,
  GatewayServerEvent,
  GatewaySnapshot,
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

export const GATEWAY_V1_MESSAGE_REQUEST: GatewayMessageRequest = {
  protocolVersion: GATEWAY_PROTOCOL_VERSION,
  message: {
    kind: 'message',
    requestId: 'req-message-fixture-1',
    idempotencyKey: 'feishu:message:fixture-1',
    actor: { id: 'user-fixture', kind: 'user', displayName: 'Fixture User' },
    conversation: { id: 'chat-fixture:thread-fixture', kind: 'thread', parentId: 'chat-fixture', threadId: 'thread-fixture' },
    replyTo: { messageId: 'message-fixture-1', threadId: 'thread-fixture' },
    text: 'Summarize the current task status.',
    extensions: { feishu: { chatId: 'chat-fixture', chatType: 'group', messageId: 'message-fixture-1', threadId: 'thread-fixture' } },
  },
}

export const GATEWAY_V1_MESSAGE_RESULT: GatewayMessageResult = {
  accepted: true,
  requestId: 'req-message-fixture-1',
  taskId: 'task-fixture-1',
  topicId: 'topic-fixture-1',
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

export const GATEWAY_V1_SNAPSHOT: GatewaySnapshot = {
  protocolVersion: GATEWAY_PROTOCOL_VERSION,
  generatedAt: 1_700_000_000_000,
  cursor: 'evt:1',
  tasks: [
    {
      taskId: 'task-fixture-1',
      topicId: 'topic-fixture-1',
      seq: 1,
      status: 'queued',
      priority: 'interactive',
      risk: 'workspace-write',
      excerpt: 'fixture task',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
  ],
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
  messageRequest: GATEWAY_V1_MESSAGE_REQUEST,
  messageResult: GATEWAY_V1_MESSAGE_RESULT,
  renderIntents: GATEWAY_V1_RENDER_INTENTS,
  taskEvent: GATEWAY_V1_TASK_EVENT,
  serverEvent: GATEWAY_V1_SERVER_EVENT,
  snapshot: GATEWAY_V1_SNAPSHOT,
} as const
