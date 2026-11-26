/** Docker runtime abstraction and CLI-backed implementation. */

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { SandboxExecRequest, SandboxExecResult, SandboxNetworkMode, SandboxResources, SandboxStats } from '@she/protocol'
import { BrokerError } from './errors.js'

const execFileAsync = promisify(execFile)

export interface DockerExtraMount {
  readonly source: string
  readonly destination: string
  readonly readOnly: boolean
}

export interface DockerContainerSpec {
  readonly containerName: string
  readonly sandboxName: string
  readonly role: string
  readonly image: string
  readonly networkMode: SandboxNetworkMode
  readonly workspacePath: string
  readonly workspaceReadOnly?: boolean
  readonly inboxPath: string
  readonly outboxPath: string
  readonly homePath: string
  readonly cachePath: string
  readonly resources?: SandboxResources
  readonly labels?: Readonly<Record<string, string>>
  readonly extraMounts?: readonly DockerExtraMount[]
  /** Command passed after the image. Arguments are never shell-interpreted. */
  readonly command?: readonly string[]
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
  exec(containerName: string, request: SandboxExecRequest): Promise<SandboxExecResult>
}

const SANDBOX_ENV = [
  'HOME=/home/agent',
  'PATH=/home/agent/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'XDG_CONFIG_HOME=/home/agent/.config',
  'XDG_DATA_HOME=/home/agent/.local/share',
  'XDG_CACHE_HOME=/cache',
  'NPM_CONFIG_PREFIX=/home/agent/.local',
  'npm_config_cache=/cache/npm',
]

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
      ...SANDBOX_ENV.flatMap(value => ['--env', value]),
      '--mount', `type=bind,src=${spec.workspacePath},dst=/workspace,${spec.workspaceReadOnly === true ? 'ro' : 'rw'}`,
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
    for (const mount of spec.extraMounts ?? []) {
      args.push('--mount', `type=bind,src=${mount.source},dst=${mount.destination},${mount.readOnly ? 'ro' : 'rw'}`)
    }
    for (const [key, value] of Object.entries(spec.labels ?? {})) args.push('--label', `${key}=${value}`)
    args.push(spec.image)
    for (const arg of spec.command ?? []) args.push(arg)
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

  async exec(containerName: string, request: SandboxExecRequest): Promise<SandboxExecResult> {
    const startedAt = Date.now()
    const cwd = request.cwd ?? '/workspace'
    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 30_000, 1_000), 300_000)
    const args = [
      'exec',
      '--workdir', cwd,
      ...SANDBOX_ENV.flatMap(value => ['--env', value]),
      containerName,
      ...request.command,
    ]
    return await new Promise<SandboxExecResult>(resolvePromise => {
      let stdout = ''
      let stderr = ''
      let truncated = false
      let timedOut = false
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const maxBytes = 256 * 1024
      const append = (current: string, chunk: Buffer): string => {
        if (current.length >= maxBytes) {
          truncated = true
          return current
        }
        const remaining = maxBytes - current.length
        const text = chunk.toString('utf8')
        if (Buffer.byteLength(text) > remaining) {
          truncated = true
          return current + text.slice(0, remaining)
        }
        return current + text
      }
      const finish = (exitCode: number, extraStderr?: string) => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        resolvePromise({
          exitCode,
          stdout,
          stderr: extraStderr === undefined ? stderr : `${stderr}${extraStderr}`,
          truncated,
          timedOut,
          startedAt,
          finishedAt: Date.now(),
        })
      }
      let child
      try {
        child = spawn(this.dockerBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        finish(127, error instanceof Error ? error.message : String(error))
        return
      }
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)
      child.stdout?.on('data', chunk => { stdout = append(stdout, Buffer.from(chunk)) })
      child.stderr?.on('data', chunk => { stderr = append(stderr, Buffer.from(chunk)) })
      child.on('error', error => finish(127, error.message))
      child.on('close', code => finish(code ?? 1))
    })
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
