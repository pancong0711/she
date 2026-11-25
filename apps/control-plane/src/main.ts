#!/usr/bin/env node
/** Executable entrypoint for the local SHE control-plane daemon. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { SequentialIdGenerator, SystemClock, TaskService } from '@she/control'
import type { AgentModelRef, GatewayWorkerHealth } from '@she/protocol'
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

export function resolveControlPlaneConfig(env: NodeJS.ProcessEnv = process.env): ControlPlaneConfig {
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim() || join(expandHome('~/.local/run'))
  const stateHome = env.XDG_STATE_HOME?.trim() || expandHome('~/.local/state')
  const configHome = env.XDG_CONFIG_HOME?.trim() || expandHome('~/.config')
  const tokenFile = env.SHE_TOKEN_FILE?.trim() || join(configHome, 'she', 'token')
  const workerPollIntervalMs = Number(env.SHE_WORKER_POLL_MS ?? 1_000)
  const workerLeaseTtlMs = Number(env.SHE_WORKER_LEASE_TTL_MS ?? 5 * 60_000)
  const providerId = env.SHE_AGENT_MODEL_PROVIDER?.trim()
  const modelId = env.SHE_AGENT_MODEL_ID?.trim()
  const variant = env.SHE_AGENT_MODEL_VARIANT?.trim()
  return {
    socketPath: env.SHE_CONTROL_SOCKET?.trim() || join(runtimeDir, 'she', 'control.sock'),
    databasePath: env.SHE_DB_PATH?.trim() || join(stateHome, 'she', 'she.db'),
    tokenFile,
    serverVersion: env.SHE_VERSION?.trim() || '0.1.0',
    workerEnabled: env.SHE_WORKER_ENABLED === '1',
    opencodeUrl: env.SHE_OPENCODE_URL?.trim() || 'http://127.0.0.1:49375',
    opencodeUsername: env.SHE_OPENCODE_USERNAME?.trim() || 'opencode',
    opencodePasswordFile: env.SHE_OPENCODE_PASSWORD_FILE?.trim() || join(configHome, 'opencode', 'service.json'),
    workspacePath: env.SHE_WORKSPACE_PATH?.trim() || join(stateHome, 'she', 'workspaces', 'default'),
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
  let workerDisabledError: string | undefined
  if (config.workerEnabled) {
    try {
      const credential = await readOpenCodeCredential(join(expandHome(config.opencodePasswordFile)))
      await mkdir(join(expandHome(config.workspacePath)), { recursive: true, mode: 0o700 })
      const agent = new OpenCodeAgentAdapter({
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
        workspacePath: join(expandHome(config.workspacePath)),
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
  const server = new ControlPlaneServer({
    socketPath: config.socketPath,
    ...(await readOptionalToken(join(expandHome(config.tokenFile))).then(token => token === undefined ? {} : { token })),
    serverVersion: config.serverVersion,
    handlers: service,
    eventStore: store.events,
    clock,
    workerStatus,
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
