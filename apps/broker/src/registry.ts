/** Atomic JSON registry and append-only audit log for the sandbox broker. */

import { randomUUID } from 'node:crypto'
import { appendFile, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SandboxSpec } from '@she/protocol'
import { BrokerError } from './errors.js'
import type { SandboxPaths } from './paths.js'

export const BROKER_REGISTRY_SCHEMA = 1 as const

export interface BrokerSandboxRecord {
  readonly name: string
  readonly role: SandboxSpec['role']
  readonly agentId: string
  readonly image: string
  readonly containerName: string
  readonly networkName: string
  readonly paths: SandboxPaths
  readonly spec: SandboxSpec
  readonly allowedCallers: readonly string[]
  readonly allowedTargets: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface BrokerRegistry {
  readonly schema: 1
  readonly mainActorId: string
  readonly sandboxes: readonly BrokerSandboxRecord[]
  readonly updatedAt: number
}

export function emptyRegistry(mainActorId: string, now: number): BrokerRegistry {
  return { schema: 1, mainActorId, sandboxes: [], updatedAt: now }
}

export class BrokerRegistryStore {
  constructor(readonly path: string) {}

  async load(mainActorId: string, now: number): Promise<BrokerRegistry> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as Partial<BrokerRegistry>
      if (parsed.schema !== 1 || !Array.isArray(parsed.sandboxes)) {
        throw new BrokerError('invalid_request', `invalid broker registry: ${this.path}`)
      }
      return {
        schema: 1,
        mainActorId: typeof parsed.mainActorId === 'string' && parsed.mainActorId !== ''
          ? parsed.mainActorId
          : mainActorId,
        sandboxes: parsed.sandboxes,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : now,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry(mainActorId, now)
      throw error instanceof BrokerError
        ? error
        : new BrokerError('invalid_request', `cannot read broker registry: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async save(registry: BrokerRegistry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.path)
    await chmod(this.path, 0o600).catch(() => undefined)
  }
}

export class BrokerAuditLog {
  constructor(readonly path: string) {}

  async append(type: string, payload: Readonly<Record<string, unknown>>, now = Date.now()): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const line = JSON.stringify({ at: now, type, ...payload })
    await appendFile(this.path, `${line}\n`, { mode: 0o600 })
    await chmod(this.path, 0o600).catch(() => undefined)
  }
}
