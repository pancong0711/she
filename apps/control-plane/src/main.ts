#!/usr/bin/env node
/** Executable entrypoint for the local SHE control-plane daemon. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { SequentialIdGenerator, SystemClock, TaskService } from '@she/control'
import { SqliteStore } from '@she/store-sqlite'
import { ControlPlaneServer } from './server.js'
import { SheCommandService } from './command-service.js'

export interface ControlPlaneConfig {
  readonly socketPath: string
  readonly databasePath: string
  readonly tokenFile: string
  readonly serverVersion: string
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
  return {
    socketPath: env.SHE_CONTROL_SOCKET?.trim() || join(runtimeDir, 'she', 'control.sock'),
    databasePath: env.SHE_DB_PATH?.trim() || join(stateHome, 'she', 'she.db'),
    tokenFile,
    serverVersion: env.SHE_VERSION?.trim() || '0.1.0',
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
  const server = new ControlPlaneServer({
    socketPath: config.socketPath,
    ...(await readOptionalToken(join(expandHome(config.tokenFile))).then(token => token === undefined ? {} : { token })),
    serverVersion: config.serverVersion,
    handlers: service,
    eventStore: store.events,
    clock,
  })
  await server.start()
  process.stdout.write(`she-control-plane listening on ${config.socketPath}\n`)

  const shutdown = async (signal: string) => {
    process.stdout.write(`she-control-plane shutting down (${signal})\n`)
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
