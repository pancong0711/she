#!/usr/bin/env node
/** Executable entrypoint for the local SHE control-plane daemon. */

import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { join, parse } from 'node:path'
import { access, mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { SequentialIdGenerator, SystemClock, TaskService } from '@she/control'
import type { AgentModelRef, AgentRuntimeStatus, GatewayWorkerHealth, WorkspaceAccessView } from '@she/protocol'
import { OpenCodeAgentAdapter } from '@she/agent-opencode'
import { SqliteStore } from '@she/store-sqlite'
import { ControlPlaneServer } from './server.js'
import { SheCommandService } from './command-service.js'
import { TaskWorker } from './worker.js'

export interface ControlPlaneConfig {
  readonly socketPath: string
  readonly databasePath: string
  readonly tokenFile: string
  readonly serverVersion: string
  readonly workerEnabled: boolean
  readonly opencodeUrl: string
  readonly opencodeUsername: string
  readonly opencodePasswordFile: string
  readonly workspacePath: string
  readonly workerPollIntervalMs: number
  readonly workerLeaseTtlMs: number
  readonly model?: AgentModelRef
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

/** Resolve the canonical SHE_HOME without importing app-shell code into core. */
export function resolveSheHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SHE_HOME?.trim()
  if (explicit !== undefined && explicit !== '') return expandHome(explicit)
  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || expandHome('~/AppData/Local')
    return join(localAppData, 'SHE')
  }
  const dataHome = env.XDG_DATA_HOME?.trim() || expandHome('~/.local/share')
  return join(dataHome, 'she')
}

export function resolveControlPlaneConfig(env: NodeJS.ProcessEnv = process.env): ControlPlaneConfig {
  const sheHome = resolveSheHome(env)
  const runtimeDir = env.SHE_RUNTIME_DIR?.trim()
    || (env.XDG_RUNTIME_DIR?.trim() ? join(env.XDG_RUNTIME_DIR.trim(), 'she') : join(sheHome, 'run'))
  const stateHome = env.SHE_STATE_HOME?.trim() || join(sheHome, 'state')
  const configHome = env.SHE_CONFIG_HOME?.trim() || join(sheHome, 'config')
  const tokenFile = env.SHE_TOKEN_FILE?.trim() || join(configHome, 'token')
  const workerPollIntervalMs = Number(env.SHE_WORKER_POLL_MS ?? 1_000)
  const workerLeaseTtlMs = Number(env.SHE_WORKER_LEASE_TTL_MS ?? 5 * 60_000)
  const providerId = env.SHE_AGENT_MODEL_PROVIDER?.trim()
  const modelId = env.SHE_AGENT_MODEL_ID?.trim()
  const variant = env.SHE_AGENT_MODEL_VARIANT?.trim()
  return {
    socketPath: env.SHE_CONTROL_SOCKET?.trim() || join(runtimeDir, 'control.sock'),
    databasePath: env.SHE_DB_PATH?.trim() || join(stateHome, 'she.db'),
    tokenFile,
    serverVersion: env.SHE_VERSION?.trim() || '0.1.0',
    workerEnabled: env.SHE_WORKER_ENABLED === '1',
    opencodeUrl: env.SHE_OPENCODE_URL?.trim() || 'http://127.0.0.1:49375',
    opencodeUsername: env.SHE_OPENCODE_USERNAME?.trim() || 'opencode',
    opencodePasswordFile: env.SHE_OPENCODE_PASSWORD_FILE?.trim() || join(configHome, 'opencode', 'service.json'),
    workspacePath: env.SHE_WORKSPACE_PATH?.trim()
      || join(env.SHE_WORKSPACE_ROOT?.trim() || join(sheHome, 'workspaces'), 'default'),
    workerPollIntervalMs: Number.isInteger(workerPollIntervalMs) && workerPollIntervalMs > 0 ? workerPollIntervalMs : 1_000,
    workerLeaseTtlMs: Number.isInteger(workerLeaseTtlMs) && workerLeaseTtlMs > 0 ? workerLeaseTtlMs : 5 * 60_000,
    ...(providerId !== undefined && providerId !== '' && modelId !== undefined && modelId !== ''
      ? { model: { providerId, modelId, ...(variant === undefined || variant === '' ? {} : { variant }) } }
      : {}),
  }
}

async function readOptionalToken(path: string): Promise<string | undefined> {
  try {
    const value = (await readFile(path, 'utf8')).trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

async function readOpenCodeCredential(path: string): Promise<string> {
  const text = await readFile(path, 'utf8')
  const parsed = JSON.parse(text) as { password?: unknown }
  if (typeof parsed.password !== 'string' || parsed.password === '') {
    throw new Error(`OpenCode credential file has no password: ${path}`)
  }
  return parsed.password
}

async function inspectWorkspace(path: string): Promise<WorkspaceAccessView> {
  const home = await realpath(homedir()).catch(() => homedir())
  const view: WorkspaceAccessView = {
    key: 'worker-default',
    path,
    source: 'SHE_WORKSPACE_PATH',
    exists: false,
    isDirectory: false,
    readable: false,
    writable: false,
    executable: false,
    readOnly: false,
    leafAuthorized: false,
    warnings: [],
  }
  try {
    const info = await stat(path)
    const realPath = await realpath(path)
    const [readable, writable, executable] = await Promise.all([
      access(path, fsConstants.R_OK).then(() => true).catch(() => false),
      access(path, fsConstants.W_OK).then(() => true).catch(() => false),
      access(path, fsConstants.X_OK).then(() => true).catch(() => false),
    ])
    const warnings: string[] = []
    const leafAuthorized = realPath !== parse(realPath).root && realPath !== home
    if (!info.isDirectory()) warnings.push('已配置的 workspace 不是目录。')
    if (!leafAuthorized) warnings.push('workspace 不能是文件系统根目录或用户主目录本身。')
    if (!writable) warnings.push('当前用户对 workspace 不可写；worker 任务可能失败。')
    return {
      ...view,
      realPath,
      exists: true,
      isDirectory: info.isDirectory(),
      readable,
      writable,
      executable,
      readOnly: !writable,
      leafAuthorized,
      warnings,
    }
  } catch {
    return { ...view, warnings: ['workspace 尚不存在；worker 启用时 control-plane 会尝试创建它。'] }
  }
}

async function main(): Promise<void> {
  const config = resolveControlPlaneConfig()
  const store = SqliteStore.open(config.databasePath)
  const clock = new SystemClock()
  const ids = new SequentialIdGenerator()
  const commands = new TaskService({
    clock,
    ids,
    topics: store.topics,
    tasks: store.tasks,
    artifacts: store.artifacts,
    requests: store.requests,
    events: store.events,
  })
  const service = new SheCommandService({
    commands,
    tasks: store.tasks,
    events: store.events,
    clock,
  })
  let worker: TaskWorker | undefined
  let agent: OpenCodeAgentAdapter | undefined
  let workerDisabledError: string | undefined
  const workspacePath = join(expandHome(config.workspacePath))
  if (config.workerEnabled) {
    try {
      const credential = await readOpenCodeCredential(join(expandHome(config.opencodePasswordFile)))
      await mkdir(workspacePath, { recursive: true, mode: 0o700 })
      agent = new OpenCodeAgentAdapter({
        baseUrl: config.opencodeUrl,
        username: config.opencodeUsername,
        credential,
      })
      worker = new TaskWorker({
        deps: {
          clock,
          ids,
          topics: store.topics,
          tasks: store.tasks,
          artifacts: store.artifacts,
          requests: store.requests,
          events: store.events,
          leases: store.leases,
        },
        agent,
        workspacePath,
        pollIntervalMs: config.workerPollIntervalMs,
        leaseTtlMs: config.workerLeaseTtlMs,
        ...(config.model === undefined ? {} : { model: config.model }),
      })
      worker.start()
      process.stdout.write(`she-control-plane worker enabled -> ${config.opencodeUrl}\n`)
    } catch (error) {
      workerDisabledError = error instanceof Error ? error.message : String(error)
      process.stderr.write(`she-control-plane worker disabled: ${workerDisabledError}\n`)
    }
  } else {
    process.stdout.write('she-control-plane worker disabled (SHE_WORKER_ENABLED != 1)\n')
  }
  const workerStatus = (): GatewayWorkerHealth => worker?.status() ?? {
    enabled: config.workerEnabled,
    state: config.workerEnabled ? 'error' : 'disabled',
    ...(workerDisabledError === undefined ? {} : { lastError: workerDisabledError }),
    updatedAt: Date.now(),
  }
  const agentStatus = async (): Promise<AgentRuntimeStatus> => {
    const health = agent === undefined
      ? {
          adapterId: 'opencode',
          ok: false,
          detail: config.workerEnabled
            ? (workerDisabledError ?? 'OpenCode adapter is not configured')
            : 'worker disabled (SHE_WORKER_ENABLED != 1)',
          checkedAt: Date.now(),
        }
      : await agent.health()
    return {
      configured: config.workerEnabled,
      adapterId: 'opencode',
      displayName: 'OpenCode',
      url: config.opencodeUrl,
      username: config.opencodeUsername,
      credentialFile: join(expandHome(config.opencodePasswordFile)),
      ...(config.model === undefined ? {} : { model: config.model }),
      health,
      workspace: await inspectWorkspace(workspacePath),
    }
  }
  const server = new ControlPlaneServer({
    socketPath: config.socketPath,
    ...(await readOptionalToken(join(expandHome(config.tokenFile))).then(token => token === undefined ? {} : { token })),
    serverVersion: config.serverVersion,
    handlers: service,
    eventStore: store.events,
    clock,
    workerStatus,
    agentStatus,
    artifacts: store.artifacts,
    artifactRoot: workspacePath,
    requestShutdown: () => {
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 250).unref()
    },
  })
  await server.start()
  process.stdout.write(`she-control-plane listening on ${config.socketPath}\n`)

  const shutdown = async (signal: string) => {
    process.stdout.write(`she-control-plane shutting down (${signal})\n`)
    await worker?.stop()
    await server.close()
    store.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

const isDirect = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
if (isDirect) {
  await main()
}

export { main }
