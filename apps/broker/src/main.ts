#!/usr/bin/env node
/** Executable entrypoint for the SHE sandbox broker daemon. */

import { homedir, hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { DockerCliRuntime } from './docker-runtime.js'
import { SandboxBrokerService } from './service.js'
import { BrokerServer } from './server.js'

export interface BrokerConfig {
  readonly socketPath: string
  readonly dataRoot: string
  readonly registryPath: string
  readonly auditPath: string
  readonly tokenFile: string
  readonly mainActorId: string
  readonly brokerVersion: string
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

export function resolveSheHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SHE_HOME?.trim()
  if (explicit !== undefined && explicit !== '') return expandHome(explicit)
  if (process.platform === 'win32') {
    return join(env.LOCALAPPDATA?.trim() || expandHome('~/AppData/Local'), 'SHE')
  }
  return join(env.XDG_DATA_HOME?.trim() || expandHome('~/.local/share'), 'she')
}

export function resolveBrokerConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const sheHome = resolveSheHome(env)
  const runtimeDir = env.SHE_RUNTIME_DIR?.trim()
    || (env.XDG_RUNTIME_DIR?.trim() ? join(env.XDG_RUNTIME_DIR.trim(), 'she') : join(sheHome, 'run'))
  const configHome = env.SHE_CONFIG_HOME?.trim() || join(sheHome, 'config')
  const stateHome = env.SHE_STATE_HOME?.trim() || join(sheHome, 'state')
  const user = userInfo().username.replace(/[^a-zA-Z0-9._-]/g, '-')
  const host = hostname().replace(/[^a-zA-Z0-9._-]/g, '-')
  return {
    socketPath: env.SHE_BROKER_SOCKET?.trim() || join(runtimeDir, 'broker.sock'),
    dataRoot: env.SHE_SANDBOX_ROOT?.trim() || join(sheHome, 'sandboxes'),
    registryPath: env.SHE_BROKER_REGISTRY?.trim() || join(stateHome, 'broker', 'registry.json'),
    auditPath: env.SHE_BROKER_AUDIT?.trim() || join(stateHome, 'broker', 'audit.jsonl'),
    tokenFile: env.SHE_BROKER_TOKEN_FILE?.trim() || join(configHome, 'broker-token'),
    mainActorId: env.SHE_MAIN_ACTOR_ID?.trim() || `main:${host}:${user}`,
    brokerVersion: env.SHE_VERSION?.trim() || '0.1.0',
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
  const config = resolveBrokerConfig()
  const service = new SandboxBrokerService({
    dataRoot: config.dataRoot,
    registryPath: config.registryPath,
    auditPath: config.auditPath,
    docker: new DockerCliRuntime(),
    mainActorId: config.mainActorId,
    brokerVersion: config.brokerVersion,
  })
  await service.init()
  const token = await readOptionalToken(expandHome(config.tokenFile))
  const server = new BrokerServer({
    socketPath: config.socketPath,
    service,
    brokerVersion: config.brokerVersion,
    ...(token === undefined ? {} : { token }),
  })
  await server.start()
  process.stdout.write(`she-broker listening on ${config.socketPath}\n`)
  process.stdout.write(`sandbox data root: ${config.dataRoot}\n`)

  const shutdown = async (signal: string) => {
    process.stdout.write(`she-broker shutting down (${signal})\n`)
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

const isDirect = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
if (isDirect) await main()

export { main }
