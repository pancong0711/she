/** Lifecycle and 0600 environment-file management for SHE's direct Feishu gateway. */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const ALLOWED_KEYS = new Set([
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_DOMAIN',
  'FEISHU_REQUIRE_MENTION',
  'FEISHU_ALLOWED_OPEN_IDS',
  'FEISHU_ALLOWED_CHAT_IDS',
])

export function parseFeishuEnv(text) {
  const result = {}
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (match === null || !ALLOWED_KEYS.has(match[1])) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[match[1]] = value
  }
  return result
}

export function normalizeFeishuConfig(input, current = {}) {
  const appId = String(input.appId ?? current.FEISHU_APP_ID ?? '').trim()
  if (appId === '') throw new Error('Feishu App ID is required')
  if (!/^cli_[A-Za-z0-9_-]+$/.test(appId)) throw new Error('Feishu App ID must start with cli_')
  const submittedSecret = String(input.appSecret ?? '').trim()
  const appSecret = submittedSecret !== '' ? submittedSecret : String(current.FEISHU_APP_SECRET ?? '').trim()
  if (appSecret === '') throw new Error('Feishu App Secret is required')
  const domain = String(input.domain ?? current.FEISHU_DOMAIN ?? 'feishu').trim() === 'lark' ? 'lark' : 'feishu'
  const requireMention = input.requireMention === true
  const allowedOpenIds = String(input.allowedOpenIds ?? current.FEISHU_ALLOWED_OPEN_IDS ?? '').split(',').map(item => item.trim()).filter(Boolean)
  const allowedChatIds = String(input.allowedChatIds ?? current.FEISHU_ALLOWED_CHAT_IDS ?? '').split(',').map(item => item.trim()).filter(Boolean)
  return {
    FEISHU_APP_ID: appId,
    FEISHU_APP_SECRET: appSecret,
    FEISHU_DOMAIN: domain,
    FEISHU_REQUIRE_MENTION: requireMention ? '1' : '0',
    ...(allowedOpenIds.length === 0 ? {} : { FEISHU_ALLOWED_OPEN_IDS: allowedOpenIds.join(',') }),
    ...(allowedChatIds.length === 0 ? {} : { FEISHU_ALLOWED_CHAT_IDS: allowedChatIds.join(',') }),
  }
}

export function serializeFeishuEnv(config) {
  const lines = ['# SHE direct Feishu gateway. Keep this file mode 0600.', '# The Feishu App Secret is read only by this local gateway process.']
  for (const key of ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_DOMAIN', 'FEISHU_REQUIRE_MENTION', 'FEISHU_ALLOWED_OPEN_IDS', 'FEISHU_ALLOWED_CHAT_IDS']) {
    if (config[key] !== undefined && config[key] !== '') lines.push(`${key}=${config[key]}`)
  }
  return `${lines.join('\n')}\n`
}

async function fileInfo(path) {
  try {
    const info = await stat(path)
    return { exists: true, mode: info.mode & 0o777 }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false }
    throw error
  }
}

export class FeishuGatewayManager {
  constructor(options) {
    this.envFile = options.envFile
    this.entry = options.entry
    this.childEnv = options.env ?? process.env
    this.controlSocket = options.controlSocket
    this.tokenFile = options.tokenFile
    this.child = null
    this.startedAt = null
    this.lastError = null
    this.logs = []
  }

  append(stream, text) {
    for (const line of String(text).replace(/\r/g, '').split('\n')) {
      if (line === '') continue
      this.logs.push({ at: Date.now(), stream, text: line })
      while (this.logs.length > 300) this.logs.shift()
    }
  }

  async status() {
    const info = await fileInfo(this.envFile)
    let env = {}
    if (info.exists) env = parseFeishuEnv(await readFile(this.envFile, 'utf8'))
    let entryExists = true
    try { await access(this.entry) } catch { entryExists = false }
    return {
      schema: 1,
      checkedAt: Date.now(),
      envFile: {
        path: this.envFile,
        exists: info.exists,
        mode: info.mode,
        permissionsOk: info.mode === undefined ? undefined : info.mode === 0o600,
        appId: env.FEISHU_APP_ID ?? '',
        appIdConfigured: typeof env.FEISHU_APP_ID === 'string' && env.FEISHU_APP_ID !== '',
        appSecretConfigured: typeof env.FEISHU_APP_SECRET === 'string' && env.FEISHU_APP_SECRET !== '',
        domain: env.FEISHU_DOMAIN === 'lark' ? 'lark' : 'feishu',
        requireMention: env.FEISHU_REQUIRE_MENTION !== '0',
        allowedOpenIds: env.FEISHU_ALLOWED_OPEN_IDS ?? '',
        allowedChatIds: env.FEISHU_ALLOWED_CHAT_IDS ?? '',
      },
      runtime: {
        entry: this.entry,
        entryExists,
        running: this.child !== null,
        pid: this.child?.pid ?? null,
        startedAt: this.startedAt,
        lastError: this.lastError,
        logs: this.logs.slice(-120),
      },
      legacy: true,
      preferred: 'external feishu4dsh standalone gateway (gateway.v1)',
      note: 'LEGACY：SHE 内置 Feishu gateway 已进入退役路线。推荐使用 feishu4dsh standalone gateway 直连 SHE；App Secret 仍只保存在本地 0600 env 文件，core/agent 不读取。',
    }
  }

  async save(input) {
    const currentInfo = await fileInfo(this.envFile)
    const current = currentInfo.exists ? parseFeishuEnv(await readFile(this.envFile, 'utf8')) : {}
    const config = normalizeFeishuConfig(input, current)
    await mkdir(dirname(this.envFile), { recursive: true, mode: 0o700 })
    const temporary = `${this.envFile}.${randomUUID()}.tmp`
    await writeFile(temporary, serializeFeishuEnv(config), { mode: 0o600 })
    await rename(temporary, this.envFile)
    return await this.status()
  }

  async start() {
    if (this.child !== null) return await this.status()
    const status = await this.status()
    if (!status.envFile.exists || !status.envFile.appIdConfigured || !status.envFile.appSecretConfigured) {
      throw new Error('Feishu gateway credentials are not configured')
    }
    if (!status.runtime.entryExists) throw new Error(`Feishu gateway runtime not found: ${this.entry}`)
    this.lastError = null
    const child = spawn(process.execPath, [this.entry], {
      env: {
        ...this.childEnv,
        SHE_FEISHU_ENV_FILE: this.envFile,
        SHE_CONTROL_SOCKET: this.controlSocket,
        SHE_TOKEN_FILE: this.tokenFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    this.startedAt = Date.now()
    child.stdout.on('data', chunk => this.append('stdout', chunk.toString('utf8')))
    child.stderr.on('data', chunk => this.append('stderr', chunk.toString('utf8')))
    child.on('error', error => { this.lastError = error.message; this.child = null; this.startedAt = null })
    child.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) this.lastError = `Feishu gateway exited with code ${String(code)}`
      else if (signal !== null) this.lastError = `Feishu gateway stopped by ${signal}`
      this.append('system', `gateway exited code=${String(code)} signal=${String(signal)}`)
      this.child = null
      this.startedAt = null
    })
    return await this.status()
  }

  async stop() {
    const child = this.child
    if (child === null) return await this.status()
    const exited = new Promise(resolvePromise => child.once('exit', () => resolvePromise(true)))
    child.kill('SIGTERM')
    const graceful = await Promise.race([
      exited,
      new Promise(resolvePromise => setTimeout(() => resolvePromise(false), 5_000)),
    ])
    if (!graceful) child.kill('SIGKILL')
    this.child = null
    this.startedAt = null
    return await this.status()
  }
}
