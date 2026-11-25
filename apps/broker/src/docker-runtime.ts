/** Docker runtime abstraction and CLI-backed implementation. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SandboxNetworkMode, SandboxResources, SandboxStats } from '@she/protocol'
import { BrokerError } from './errors.js'

const execFileAsync = promisify(execFile)

export interface DockerContainerSpec {
  readonly containerName: string
  readonly sandboxName: string
  readonly role: string
  readonly image: string
  readonly networkMode: SandboxNetworkMode
  readonly workspacePath: string
  readonly inboxPath: string
  readonly outboxPath: string
  readonly homePath: string
  readonly cachePath: string
  readonly resources?: SandboxResources
  readonly labels?: Readonly<Record<string, string>>
}

export interface DockerInspectResult {
  readonly state: 'running' | 'stopped' | 'missing' | 'unknown'
  readonly startedAt?: number
  readonly detail?: string
}

export interface DockerRuntime {
  health(): Promise<{ ok: boolean; version?: string; detail?: string }>
  createContainer(spec: DockerContainerSpec): Promise<void>
  start(containerName: string): Promise<void>
  stop(containerName: string): Promise<void>
  restart(containerName: string): Promise<void>
  removeContainer(containerName: string): Promise<void>
  removeNetwork(networkName: string): Promise<void>
  inspect(containerName: string): Promise<DockerInspectResult>
  stats(containerName: string): Promise<SandboxStats | undefined>
}

interface DockerState {
  readonly Status?: string
  readonly Running?: boolean
  readonly StartedAt?: string
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseBytes(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const match = /^([0-9.]+)\s*([KMGTP]?i?B)$/i.exec(value.trim())
  if (match === null) return undefined
  const number = Number(match[1])
  if (!Number.isFinite(number)) return undefined
  const unit = match[2]?.toUpperCase() ?? 'B'
  const factors: Record<string, number> = {
    B: 1,
    KB: 1_000,
    MB: 1_000_000,
    GB: 1_000_000_000,
    KIB: 1_024,
    MIB: 1_024 ** 2,
    GIB: 1_024 ** 3,
  }
  return Math.round(number * (factors[unit] ?? 1))
}

/** Docker CLI runtime. Arguments are fixed by SHE, never supplied by agents. */
export class DockerCliRuntime implements DockerRuntime {
  constructor(private readonly dockerBin = 'docker', private readonly timeoutMs = 20_000) {}

  private async run(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.dockerBin, [...args], {
        timeout: this.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      })
      return String(stdout)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new BrokerError('docker_failed', `docker ${args[0] ?? ''} failed: ${message}`)
    }
  }

  async health(): Promise<{ ok: boolean; version?: string; detail?: string }> {
    try {
      const version = (await this.run(['version', '--format', '{{.Server.Version}}'])).trim()
      return { ok: true, ...(version === '' ? {} : { version }) }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  async createContainer(spec: DockerContainerSpec): Promise<void> {
    const args = [
      'run', '-d',
      '--name', spec.containerName,
      '--hostname', spec.sandboxName,
      '--read-only',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--network', spec.networkMode === 'none' ? 'none' : 'bridge',
      '--mount', `type=bind,src=${spec.workspacePath},dst=/workspace,rw`,
      '--mount', `type=bind,src=${spec.inboxPath},dst=/inbox,ro`,
      '--mount', `type=bind,src=${spec.outboxPath},dst=/outbox,rw`,
      '--mount', `type=bind,src=${spec.homePath},dst=/home/agent,rw`,
      '--mount', `type=bind,src=${spec.cachePath},dst=/cache,rw`,
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--label', `she.sandbox=${spec.sandboxName}`,
      '--label', `she.role=${spec.role}`,
    ]
    if (spec.resources?.cpus !== undefined) args.push('--cpus', String(spec.resources.cpus))
    if (spec.resources?.memoryMb !== undefined) args.push('--memory', `${String(spec.resources.memoryMb)}m`)
    if (spec.resources?.pids !== undefined) args.push('--pids-limit', String(spec.resources.pids))
    for (const [key, value] of Object.entries(spec.labels ?? {})) args.push('--label', `${key}=${value}`)
    args.push(spec.image)
    await this.run(args)
  }

  async start(containerName: string): Promise<void> {
    await this.run(['start', containerName])
  }

  async stop(containerName: string): Promise<void> {
    await this.run(['stop', containerName])
  }

  async restart(containerName: string): Promise<void> {
    await this.run(['restart', containerName])
  }

  async removeContainer(containerName: string): Promise<void> {
    await this.run(['rm', '-f', containerName])
  }

  async removeNetwork(networkName: string): Promise<void> {
    await this.run(['network', 'rm', networkName]).catch(() => undefined)
  }

  async inspect(containerName: string): Promise<DockerInspectResult> {
    try {
      const raw = await this.run(['inspect', '--format', '{{json .State}}', containerName])
      const state = JSON.parse(raw) as DockerState
      if (state.Running === true || state.Status === 'running') {
        const startedAt = parseTimestamp(state.StartedAt)
        return { state: 'running', ...(startedAt === undefined ? {} : { startedAt }) }
      }
      return { state: 'stopped', ...(state.Status === undefined ? {} : { detail: state.Status }) }
    } catch (error) {
      if (error instanceof BrokerError && /No such object|No such container/i.test(error.message)) {
        return { state: 'missing' }
      }
      return { state: 'unknown', detail: error instanceof Error ? error.message : String(error) }
    }
  }

  async stats(containerName: string): Promise<SandboxStats | undefined> {
    try {
      const raw = (await this.run(['stats', '--no-stream', '--format', '{{json .}}', containerName])).trim()
      if (raw === '') return undefined
      const parsed = JSON.parse(raw) as Record<string, string>
      const cpu = parsed.CPUPerc?.replace('%', '')
      const [memoryUsage, memoryLimit] = (parsed.MemUsage ?? '').split('/').map(item => item.trim())
      const pids = parsed.Pids?.trim()
      const memoryBytes = parseBytes(memoryUsage)
      const memoryLimitBytes = parseBytes(memoryLimit)
      return {
        name: containerName,
        ...(cpu === undefined || !Number.isFinite(Number(cpu)) ? {} : { cpuPercent: Number(cpu) }),
        ...(memoryBytes === undefined ? {} : { memoryBytes }),
        ...(memoryLimitBytes === undefined ? {} : { memoryLimitBytes }),
        ...(pids === undefined || !Number.isFinite(Number(pids)) ? {} : { pids: Number(pids) }),
        collectedAt: Date.now(),
      }
    } catch {
      return undefined
    }
  }
}
