/** Default SHE command semantics exposed through gateway.v1. */

import type { Clock, EventStore, Task, TaskRepository } from '@she/core'
import type {
  CardRenderIntent,
  GatewayCommandInvocation,
  GatewayCommandResult,
  GatewayInteractionResponse,
  GatewayInteractionResult,
  GatewayMessageEvent,
  GatewayMessageResult,
  GatewaySnapshot,
  GatewayTaskSnapshot,
  RenderIntent,
  SheError,
} from '@she/protocol'
import { GATEWAY_PROTOCOL_VERSION, sheError } from '@she/protocol'
import { TaskService, TaskServiceError } from '@she/control'
import type { ControlPlaneHandlers } from './server.js'

export interface SheCommandServiceDeps {
  readonly commands: TaskService
  readonly tasks: TaskRepository
  readonly events: EventStore
  readonly clock: Clock
}

function textRender(renderId: string, text: string, format: 'plain' | 'markdown' = 'markdown'): RenderIntent {
  return { kind: 'text', renderId, sequence: 1, format, text }
}

/**
 * Parse the command body from either direct SHE syntax (`/list`) or the
 * legacy `/she list` alias. Returns undefined for non-command text.
 */
export function parseSheCommand(rawCommand: string): string | undefined {
  const raw = rawCommand.trim()
  if (!raw.startsWith('/')) return undefined
  const body = raw.slice(1).trim()
  if (body === 'she') return ''
  if (body.startsWith('she ')) return body.slice(4).trim()
  return body
}

function taskErrorOf(task: Task): SheError | undefined {
  if (task.error === null) return undefined
  return sheError('internal', task.error.message, {
    retryable: task.error.retryable,
    details: { domainCode: task.error.code },
  })
}

function taskSnapshotOf(task: Task): GatewayTaskSnapshot {
  const error = taskErrorOf(task)
  return {
    taskId: task.id,
    topicId: task.topicId,
    seq: task.seq,
    status: task.status,
    priority: task.priority,
    risk: task.risk,
    excerpt: task.requestExcerpt,
    ...(task.agentSessionId === null ? {} : { agentSessionId: task.agentSessionId }),
    ...(task.sandboxName === null ? {} : { sandboxName: task.sandboxName }),
    ...(error === undefined ? {} : { error }),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.startedAt === null ? {} : { startedAt: task.startedAt }),
    ...(task.finishedAt === null ? {} : { finishedAt: task.finishedAt }),
  }
}

function taskLabel(task: Task): string {
  return `#${String(task.seq)} ${task.id} · ${task.status} · ${task.requestExcerpt}`
}

/**
 * Minimal command layer for the first gateway contract.
 *
 * Supported:
 *   /she help
 *   /she list
 *   /she status <task-id>
 *   /she submit <request>
 *   /she cancel <task-id>
 *
 * Richer command semantics and card UX will be layered on this service without
 * changing the gateway transport.
 */
export class SheCommandService implements ControlPlaneHandlers {
  constructor(private readonly deps: SheCommandServiceDeps) {}

  async command(command: GatewayCommandInvocation): Promise<GatewayCommandResult> {
    const renderId = `${command.requestId}:0`
    const args = parseSheCommand(command.rawCommand)
    if (args === undefined) {
      return {
        accepted: false,
        requestId: command.requestId,
        commandResult: { renderIntents: [textRender(renderId, 'Expected a SHE command such as `/help`.')] },
      }
    }
    if (args === '' || args === 'help' || args === '?') return this.help(command.requestId, renderId)
    if (args === 'list') return this.list(command, renderId)
    if (args === 'stop') return this.stopLatest(command, renderId)
    if (args.startsWith('status ')) return this.status(command.requestId, renderId, args.slice('status '.length).trim())
    if (args.startsWith('submit ')) return this.submit(command, renderId, args.slice('submit '.length))
    if (args.startsWith('cancel ')) return this.cancel(command.requestId, renderId, args.slice('cancel '.length).trim())
    return {
      accepted: false,
      requestId: command.requestId,
      commandResult: {
        renderIntents: [textRender(renderId, `Unknown SHE command: \`${args}\`. Try \`/help\`.`)],
      },
    }
  }

  /**
   * Accept one ordinary gateway message and enqueue it as a task in the
   * conversation's own topic. The task runner uses the topic id as its agent
   * session key, so each Feishu chat/thread gets an isolated persistent
   * session even while this first phase uses the configured default agent.
   */
  async message(message: GatewayMessageEvent): Promise<GatewayMessageResult> {
    if (message.text.trim() === '') {
      throw new TaskServiceError('invalid_request', 'message text must not be empty')
    }
    const result = await this.deps.commands.submit({
      conversationKey: message.conversation.id,
      workspaceKey: message.workspaceKey?.trim() || 'default',
      request: message.text,
      ...(message.attachments === undefined || message.attachments.length === 0 ? {} : { attachments: message.attachments }),
      ...(message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey }),
    })
    return {
      accepted: true,
      requestId: message.requestId,
      taskId: result.task.id,
      topicId: result.topic.id,
    }
  }

  async interaction(input: GatewayInteractionResponse): Promise<GatewayInteractionResult> {
    return {
      accepted: true,
      interactionId: input.interactionId,
      commandResult: {
        renderIntents: [textRender(`${input.requestId}:0`, 'Interaction received.')],
      },
    }
  }

  async snapshot(): Promise<GatewaySnapshot> {
    const tasks = await this.deps.tasks.listAll()
    const bounds = await this.deps.events.bounds()
    return {
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      generatedAt: this.deps.clock.now(),
      cursor: bounds.newestSequence === null ? null : `evt:${bounds.newestSequence}`,
      tasks: tasks.map(taskSnapshotOf),
    }
  }

  private help(requestId: string, renderId: string): GatewayCommandResult {
    const card: CardRenderIntent = {
      kind: 'card',
      renderId,
      sequence: 1,
      title: 'SHE help',
      blocks: [
        { type: 'text', text: 'Available commands', format: 'markdown' },
        {
          type: 'list',
          items: [
            { id: 'submit', primary: '/submit <request>', secondary: 'enqueue a task' },
            { id: 'list', primary: '/list', secondary: 'list tasks in this conversation' },
            { id: 'status', primary: '/status <task-id>', secondary: 'show task status' },
            { id: 'cancel', primary: '/cancel <task-id>', secondary: 'cancel a queued/running task' },
            { id: 'stop', primary: '/stop', secondary: 'cancel the latest active task in this conversation' },
          ],
        },
      ],
    }
    return { accepted: true, requestId, commandResult: { renderIntents: [card] } }
  }

  private async list(command: GatewayCommandInvocation, renderId: string): Promise<GatewayCommandResult> {
    const tasks = await this.deps.commands.listTasks(command.conversation.id)
    const card: CardRenderIntent = {
      kind: 'card',
      renderId,
      sequence: 1,
      title: `SHE tasks · ${String(tasks.length)}`,
      blocks: tasks.length === 0
        ? [{ type: 'text', text: 'No tasks in this conversation.' }]
        : [{ type: 'list', items: tasks.map(task => ({
            id: task.id,
            primary: taskLabel(task),
          })) }],
    }
    return { accepted: true, requestId: command.requestId, commandResult: { renderIntents: [card] } }
  }

  private async status(requestId: string, renderId: string, taskId: string): Promise<GatewayCommandResult> {
    if (taskId === '') return this.invalid(requestId, renderId, '/status <task-id>')
    const task = await this.deps.commands.getTask(taskId)
    if (task === undefined) return this.notFound(requestId, renderId, taskId)
    const error = taskErrorOf(task)
    const card: CardRenderIntent = {
      kind: 'card',
      renderId,
      sequence: 1,
      title: `Task ${task.id}`,
      blocks: [
        {
          type: 'fields',
          fields: [
            { label: 'Status', value: task.status },
            { label: 'Seq', value: String(task.seq) },
            { label: 'Priority', value: task.priority },
            { label: 'Risk', value: task.risk },
            ...(task.agentSessionId === null ? [] : [{ label: 'Agent session', value: task.agentSessionId }]),
            ...(error === undefined ? [] : [{ label: 'Error', value: `${error.code}: ${error.message}` }]),
          ],
        },
        { type: 'text', text: task.requestExcerpt, format: 'plain' },
      ],
    }
    return { accepted: true, requestId, commandResult: { renderIntents: [card] } }
  }

  private async stopLatest(command: GatewayCommandInvocation, renderId: string): Promise<GatewayCommandResult> {
    const tasks = await this.deps.commands.listTasks(command.conversation.id)
    const active = [...tasks]
      .sort((left, right) => right.seq - left.seq)
      .find(task => task.status === 'queued' || task.status === 'submitted' || task.status === 'running')
    if (active === undefined) {
      return {
        accepted: false,
        requestId: command.requestId,
        commandResult: { renderIntents: [textRender(renderId, 'No active task in this conversation.')] },
      }
    }
    const result = await this.deps.commands.cancelTask(active.id, 'gateway /stop')
    return {
      accepted: true,
      requestId: command.requestId,
      taskId: result.task.id,
      topicId: result.task.topicId,
      commandResult: { renderIntents: [textRender(renderId, `Task cancelled: \`${result.task.id}\`.`)] },
    }
  }

  private async submit(
    command: GatewayCommandInvocation,
    renderId: string,
    requestText: string,
  ): Promise<GatewayCommandResult> {
    if (requestText.trim() === '') return this.invalid(command.requestId, renderId, '/submit <request>')
    try {
      const result = await this.deps.commands.submit({
        conversationKey: command.conversation.id,
        workspaceKey: command.workspaceKey ?? 'default',
        request: requestText,
        ...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
      })
      return {
        accepted: true,
        requestId: command.requestId,
        taskId: result.task.id,
        topicId: result.topic.id,
        commandResult: {
          renderIntents: [textRender(renderId, `Task queued: \`${result.task.id}\` (seq ${String(result.task.seq)}).`)],
        },
      }
    } catch (error) {
      if (error instanceof TaskServiceError) {
        return this.error(command.requestId, renderId, error.code, error.message)
      }
      throw error
    }
  }

  private async cancel(requestId: string, renderId: string, taskId: string): Promise<GatewayCommandResult> {
    if (taskId === '') return this.invalid(requestId, renderId, '/cancel <task-id>')
    try {
      const result = await this.deps.commands.cancelTask(taskId, 'gateway request')
      return {
        accepted: true,
        requestId,
        taskId,
        topicId: result.task.topicId,
        commandResult: { renderIntents: [textRender(renderId, `Task cancelled: \`${taskId}\`.`)] },
      }
    } catch (error) {
      if (error instanceof TaskServiceError) return this.error(requestId, renderId, error.code, error.message)
      throw error
    }
  }

  private invalid(requestId: string, renderId: string, usage: string): GatewayCommandResult {
    return {
      accepted: false,
      requestId,
      commandResult: { renderIntents: [textRender(renderId, `Usage: \`${usage}\``)] },
    }
  }

  private notFound(requestId: string, renderId: string, taskId: string): GatewayCommandResult {
    return {
      accepted: false,
      requestId,
      commandResult: { renderIntents: [textRender(renderId, `Task not found: \`${taskId}\``)] },
    }
  }

  private error(requestId: string, renderId: string, code: string, message: string): GatewayCommandResult {
    return {
      accepted: false,
      requestId,
      commandResult: { renderIntents: [textRender(renderId, `SHE error (${code}): ${message}`)] },
    }
  }
}
