#!/usr/bin/env node
/** Direct Feishu/Lark channel for SHE. No dsh or feishu4dsh plugin required. */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createLarkChannel, Domain } from '@larksuiteoapi/node-sdk'
import { SheClient } from '@she/client'

const envFile = process.env.SHE_FEISHU_ENV_FILE?.trim() || join(homedir(), '.config', 'she', 'feishu.env')

function parseEnv(text) {
  const result = {}
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (match === null) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[match[1]] = value
  }
  return result
}

function log(level, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({ at: Date.now(), level, message, ...extra })}\n`)
}

function splitList(value) {
  return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean)
}

function renderIntentText(intent) {
  if (intent === null || typeof intent !== 'object') return ''
  if (intent.kind === 'text') return String(intent.text ?? '')
  if (intent.kind === 'progress') return String(intent.label ?? intent.stage ?? '')
  if (intent.kind === 'status') return String(intent.label ?? '')
  if (intent.kind === 'file') return `文件：${String(intent.artifact?.fileName ?? 'artifact')}`
  if (intent.kind === 'approval') return `审批：${String(intent.title ?? '')}`
  if (intent.kind === 'form') return `表单：${String(intent.title ?? '')}`
  if (intent.kind === 'card') {
    const lines = []
    if (intent.title) lines.push(`**${String(intent.title)}**`)
    for (const block of Array.isArray(intent.blocks) ? intent.blocks : []) {
      if (block.type === 'text') lines.push(String(block.text ?? ''))
      else if (block.type === 'fields') lines.push((block.fields ?? []).map(field => `**${String(field.label)}**：${String(field.value)}`).join('\n'))
      else if (block.type === 'list') lines.push((block.items ?? []).map(item => `- ${String(item.primary ?? '')}${item.secondary ? ` — ${String(item.secondary)}` : ''}`).join('\n'))
      else if (block.type === 'divider') lines.push('---')
    }
    return lines.filter(Boolean).join('\n')
  }
  return ''
}

function renderCommandResult(result) {
  const intents = result?.commandResult?.renderIntents
  if (!Array.isArray(intents) || intents.length === 0) {
    return result?.accepted ? `任务已接受${result.taskId ? `：${result.taskId}` : ''}` : 'SHE 未接受该命令'
  }
  return intents.map(renderIntentText).filter(Boolean).join('\n\n') || 'SHE 已处理该命令'
}

function truncate(text, max = 12_000) {
  const value = String(text ?? '')
  return value.length <= max ? value : `${value.slice(0, max)}\n\n…输出已截断`
}

async function loadConfig() {
  let fileEnv = {}
  try {
    fileEnv = parseEnv(await readFile(envFile, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const env = { ...fileEnv, ...process.env }
  const appId = env.FEISHU_APP_ID?.trim() || ''
  const appSecret = env.FEISHU_APP_SECRET?.trim() || ''
  if (appId === '' || appSecret === '') throw new Error(`Feishu app credentials are missing in ${envFile}`)
  const runtimeHome = env.XDG_RUNTIME_DIR?.trim() || join(homedir(), '.local', 'run')
  return {
    appId,
    appSecret,
    domain: env.FEISHU_DOMAIN?.trim() === 'lark' ? Domain.Lark : Domain.Feishu,
    requireMention: String(env.FEISHU_REQUIRE_MENTION ?? '1') !== '0',
    allowedSenders: splitList(env.FEISHU_ALLOWED_OPEN_IDS),
    allowedChats: splitList(env.FEISHU_ALLOWED_CHAT_IDS),
    controlSocket: env.SHE_CONTROL_SOCKET?.trim() || join(runtimeHome, 'she', 'control.sock'),
    tokenFile: env.SHE_TOKEN_FILE?.trim() || join(homedir(), '.config', 'she', 'token'),
  }
}

async function readToken(path) {
  try {
    return (await readFile(path, 'utf8')).trim() || undefined
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function main() {
  const config = await loadConfig()
  const policy = {
    requireMention: config.requireMention,
    ...(config.allowedChats.length === 0 ? {} : { groupAllowlist: config.allowedChats }),
    ...(config.allowedSenders.length === 0 ? {} : { dmMode: 'allowlist', dmAllowlist: config.allowedSenders }),
  }
  const channel = createLarkChannel({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    domain: config.domain,
    source: 'she-feishu-gateway',
    policy,
    safety: { chatQueue: { enabled: true }, batch: { text: { delayMs: 0 } } },
    includeRawEvent: true,
  })

  const token = await readToken(config.tokenFile)
  const client = new SheClient({
    socketPath: config.controlSocket,
    ...(token === undefined ? {} : { token }),
    timeoutMs: 30_000,
  })
  const health = await client.health()
  log('info', 'SHE control plane reachable', { version: health.version, worker: health.worker?.state ?? 'unknown' })

  const taskTargets = new Map()
  const taskText = new Map()
  const abort = new AbortController()

  function allowed(message) {
    if (config.allowedSenders.length > 0 && !config.allowedSenders.includes(message.senderId)) return false
    if (config.allowedChats.length > 0 && !config.allowedChats.includes(message.chatId)) return false
    return true
  }

  async function send(message, text) {
    const body = truncate(text).trim()
    if (body === '') return
    await channel.send(message.chatId, { markdown: body }, {
      replyTo: message.messageId,
      replyInThread: message.threadId !== undefined && message.threadId !== '',
    })
  }

  channel.on('message', async message => {
    if (!allowed(message)) {
      log('warn', 'message rejected by SHE gateway ACL', { chatId: message.chatId, senderId: message.senderId })
      return
    }
    const raw = String(message.content ?? '').trim()
    if (!raw.startsWith('/she')) return
    const conversation = message.threadId
      ? { id: `${message.chatId}:${message.threadId}`, kind: 'thread', parentId: message.chatId, threadId: message.threadId, extensions: { feishu: { chatId: message.chatId, threadId: message.threadId } } }
      : { id: message.chatId, kind: message.chatType === 'p2p' ? 'dm' : 'group', extensions: { feishu: { chatId: message.chatId } } }
    try {
      const result = await client.command({
        kind: 'command',
        requestId: randomUUID(),
        idempotencyKey: `feishu:message:${message.messageId}`,
        actor: {
          id: message.senderId,
          kind: 'user',
          ...(message.senderName ? { displayName: message.senderName } : {}),
          extensions: { feishu: { chatId: message.chatId } },
        },
        conversation,
        replyTo: {
          messageId: message.messageId,
          ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
        },
        rawCommand: raw,
        extensions: { feishu: { chatId: message.chatId, messageId: message.messageId } },
      })
      if (result.taskId) {
        taskTargets.set(result.taskId, message)
        taskText.set(result.taskId, '')
      }
      await send(message, renderCommandResult(result))
      log('info', 'SHE command forwarded', { taskId: result.taskId, accepted: result.accepted, chatId: message.chatId })
    } catch (error) {
      const text = `SHE 不可用：${error instanceof Error ? error.message : String(error)}`
      await send(message, text).catch(() => undefined)
      log('error', 'SHE command failed', { error: error instanceof Error ? error.message : String(error) })
    }
  })

  channel.on('reject', event => log('warn', 'Feishu transport rejected message', { reason: event.reason, chatId: event.chatId }))
  channel.on('error', error => log('error', 'Feishu channel error', { error: error.message, code: error.code }))
  channel.on('reconnecting', () => log('info', 'Feishu WebSocket reconnecting'))
  channel.on('reconnected', () => log('info', 'Feishu WebSocket reconnected'))

  async function eventLoop() {
    while (!abort.signal.aborted) {
      try {
        for await (const event of client.events({ signal: abort.signal })) {
          if (event.type !== 'task') continue
          const taskEvent = event.event
          const target = taskTargets.get(taskEvent.taskId)
          if (target === undefined) continue
          if (taskEvent.type === 'agent.delta' && taskEvent.channel === 'text') {
            taskText.set(taskEvent.taskId, truncate(`${taskText.get(taskEvent.taskId) ?? ''}${taskEvent.text}`, 20_000))
            continue
          }
          if (taskEvent.type === 'task.completed') {
            const output = String(taskText.get(taskEvent.taskId) ?? '').trim()
            taskTargets.delete(taskEvent.taskId)
            taskText.delete(taskEvent.taskId)
            await send(target, output === '' ? `任务完成：${taskEvent.taskId}` : `任务完成：${taskEvent.taskId}\n\n${output}`)
            continue
          }
          if (taskEvent.type === 'task.failed') {
            taskTargets.delete(taskEvent.taskId)
            taskText.delete(taskEvent.taskId)
            await send(target, `任务失败：${taskEvent.taskId}\n\n${taskEvent.error.message}`)
          }
        }
      } catch (error) {
        if (abort.signal.aborted) break
        log('error', 'SHE event stream failed', { error: error instanceof Error ? error.message : String(error) })
        await new Promise(resolvePromise => setTimeout(resolvePromise, 2_000))
      }
    }
  }

  await channel.connect()
  log('info', 'Feishu gateway connected', { bot: channel.botIdentity?.name ?? 'unknown' })
  void eventLoop()

  const shutdown = async signal => {
    log('info', 'Feishu gateway shutting down', { signal })
    abort.abort()
    await channel.disconnect().catch(() => undefined)
    await client.close().catch(() => undefined)
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

void main().catch(error => {
  log('error', 'Feishu gateway fatal', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
