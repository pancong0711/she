import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SandboxBrokerClient } from '@she/client'
import type { SandboxExecRequest, SandboxExecResult, SandboxSpec } from '@she/protocol'
import {
  BrokerServer,
  SandboxBrokerService,
  resolveBrokerConfig,
  type DockerContainerSpec,
  type DockerInspectResult,
  type DockerRuntime,
} from '@she/broker'

const cleanup: (() => Promise<void>)[] = []

class FakeDocker implements DockerRuntime {
  readonly calls: string[] = []
  readonly containers = new Map<string, DockerContainerSpec>()
  private running = new Map<string, boolean>()

  async health(): Promise<{ ok: boolean; version?: string }> {
    return { ok: true, version: 'fake-27.0' }
  }

  async createContainer(spec: DockerContainerSpec): Promise<void> {
    this.calls.push(`create:${spec.containerName}`)
    this.containers.set(spec.containerName, spec)
    this.running.set(spec.containerName, true)
  }

  async start(containerName: string): Promise<void> {
    this.calls.push(`start:${containerName}`)
    this.running.set(containerName, true)
  }

  async stop(containerName: string): Promise<void> {
    this.calls.push(`stop:${containerName}`)
    this.running.set(containerName, false)
  }

  async restart(containerName: string): Promise<void> {
    this.calls.push(`restart:${containerName}`)
    this.running.set(containerName, true)
  }

  async removeContainer(containerName: string): Promise<void> {
    this.calls.push(`remove:${containerName}`)
    this.containers.delete(containerName)
  }

  async removeNetwork(networkName: string): Promise<void> {
    this.calls.push(`network:${networkName}`)
  }

  async inspect(containerName: string): Promise<DockerInspectResult> {
    if (!this.containers.has(containerName)) return { state: 'missing' }
    return { state: this.running.get(containerName) === true ? 'running' : 'stopped', startedAt: 1_700_000_000_000 }
  }

  async stats(containerName: string) {
    return {
      name: containerName,
      cpuPercent: 1.5,
      memoryBytes: 1024,
      memoryLimitBytes: 4096,
      pids: 2,
      collectedAt: 1_700_000_000_000,
    }
  }

  async exec(containerName: string, request: SandboxExecRequest): Promise<SandboxExecResult> {
    this.calls.push(`exec:${containerName}:${request.command.join(' ')}`)
    if (this.running.get(containerName) !== true) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'container is not running',
        truncated: false,
        timedOut: false,
        startedAt: 1_700_000_000_000,
        finishedAt: 1_700_000_000_001,
      }
    }
    return {
      exitCode: 0,
      stdout: `ran:${request.command.join(' ')}`,
      stderr: '',
      truncated: false,
      timedOut: false,
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_000_001,
    }
  }
}

function sandboxSpec(name: string, overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    name,
    role: 'worker',
    agentId: 'opencode',
    image: 'she-opencode:test',
    networkMode: 'none',
    resources: { cpus: 1, memoryMb: 256, pids: 64 },
    allowedCallers: ['main'],
    ...overrides,
  }
}

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'she-broker-'))
  cleanup.push(async () => rm(dir, { recursive: true, force: true }))
  const docker = new FakeDocker()
  const homeDir = join(dir, 'home')
  await mkdir(homeDir, { recursive: true })
  const service = new SandboxBrokerService({
    dataRoot: join(dir, 'sandboxes'),
    registryPath: join(dir, 'broker', 'registry.json'),
    auditPath: join(dir, 'broker', 'audit.jsonl'),
    docker,
    mainActorId: 'main:test',
    brokerVersion: '0.1.0',
    homeDir,
    now: () => 1_700_000_000_000,
  })
  await service.init()
  return { dir, docker, service, homeDir }
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

describe('sandbox broker configuration', () => {
  it('uses SHE_HOME for broker data/config/state paths', () => {
    const config = resolveBrokerConfig({ SHE_HOME: '/srv/she', SHE_RUNTIME_DIR: '/run/she' })
    expect(config.socketPath).toBe('/run/she/broker.sock')
    expect(config.dataRoot).toBe('/srv/she/sandboxes')
    expect(config.registryPath).toBe('/srv/she/state/broker/registry.json')
    expect(config.auditPath).toBe('/srv/she/state/broker/audit.jsonl')
    expect(config.tokenFile).toBe('/srv/she/config/broker-token')
  })
})

describe('sandbox broker service', () => {
  it('creates, lists, controls and persists fixed-path sandboxes', async () => {
    const { dir, docker, service } = await harness()
    const created = await service.create(sandboxSpec('sbx-0001'))
    expect(created).toMatchObject({ name: 'sbx-0001', role: 'worker', status: 'running' })
    expect((await service.list())).toHaveLength(1)

    const root = join(dir, 'sandboxes', 'sbx-0001')
    expect(await readFile(join(root, 'sandbox.json'), 'utf8')).toContain('sbx-0001')
    expect(await readFile(join(dir, 'broker', 'audit.jsonl'), 'utf8')).toContain('sandbox.created')
    expect(docker.containers.get('she-sbx-0001')?.workspacePath).toBe(join(root, 'scratch'))

    expect((await service.start('sbx-0001')).status).toBe('running')
    expect((await service.stop('sbx-0001')).status).toBe('stopped')
    expect((await service.restart('sbx-0001')).status).toBe('running')
    expect((await service.stats('sbx-0001'))?.cpuPercent).toBe(1.5)

    const reopened = new SandboxBrokerService({
      dataRoot: join(dir, 'sandboxes'),
      registryPath: join(dir, 'broker', 'registry.json'),
      auditPath: join(dir, 'broker', 'audit.jsonl'),
      docker,
      mainActorId: 'main:test',
      now: () => 1_700_000_000_000,
    })
    await reopened.init()
    expect(await reopened.list()).toHaveLength(1)
    await reopened.destroy('sbx-0001', { preserveData: true })
    expect(await reopened.list()).toHaveLength(0)
    expect(docker.calls).toContain('remove:she-sbx-0001')
  })

  it('routes allowed messages through inbox/outbox and rejects escapes', async () => {
    const { dir, service } = await harness()
    await service.create(sandboxSpec('sbx-0001', { allowedTargets: ['sbx-0002'] }))
    await service.create(sandboxSpec('sbx-0002', { allowedCallers: ['sbx-0001'] }))

    const first = await service.sendMessage({
      messageId: 'msg-main-1',
      from: 'main:test',
      to: 'sbx-0001',
      rootTaskId: 'task-root',
      text: 'hello worker',
    })
    expect(first.artifacts[0]).toMatchObject({ fileName: 'message.txt', bytes: 12 })
    expect(await readFile(join(dir, 'sandboxes', 'sbx-0001', 'inbox', 'msg-main-1', 'manifest.json'), 'utf8'))
      .toContain('"from": "main:test"')
    expect(await readFile(join(dir, 'sandboxes', 'sbx-0001', 'inbox', 'msg-main-1', 'input', 'message.txt'), 'utf8'))
      .toBe('hello worker')

    await writeFile(join(dir, 'sandboxes', 'sbx-0001', 'outbox', 'result.txt'), 'worker result', 'utf8')
    const second = await service.sendMessage({
      messageId: 'msg-worker-1',
      from: 'sbx-0001',
      to: 'sbx-0002',
      rootTaskId: 'task-root',
      parentTaskId: 'task-1',
      artifacts: [{ fromSandbox: 'sbx-0001', fromOutbox: 'result.txt', as: 'results/result.txt' }],
    })
    expect(second.artifacts[0]?.sha256).toHaveLength(64)
    expect(await readFile(join(dir, 'sandboxes', 'sbx-0002', 'inbox', 'msg-worker-1', 'input', 'results', 'result.txt'), 'utf8'))
      .toBe('worker result')

    await expect(service.sendMessage({
      messageId: 'msg-escape',
      from: 'sbx-0001',
      to: 'sbx-0002',
      rootTaskId: 'task-root',
      artifacts: [{ fromSandbox: 'sbx-0001', fromOutbox: 'result.txt', as: '../escape.txt' }],
    })).rejects.toMatchObject({ code: 'path_escape' })

    await writeFile(join(dir, 'outside.txt'), 'outside', 'utf8')
    await symlink(join(dir, 'outside.txt'), join(dir, 'sandboxes', 'sbx-0001', 'outbox', 'link.txt'))
    await expect(service.sendMessage({
      messageId: 'msg-symlink',
      from: 'sbx-0001',
      to: 'sbx-0002',
      rootTaskId: 'task-root',
      artifacts: [{ fromSandbox: 'sbx-0001', fromOutbox: 'link.txt', as: 'link.txt' }],
    })).rejects.toMatchObject({ code: 'path_escape' })

    await expect(service.sendMessage({
      messageId: 'msg-forbidden',
      from: 'sbx-0002',
      to: 'sbx-0001',
      rootTaskId: 'task-root',
      text: 'nope',
    })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('supports validated workspace, legacy and credential host mounts', async () => {
    const { dir, docker, service, homeDir } = await harness()
    const workspace = join(dir, 'host-workspace')
    const legacy = join(dir, 'legacy')
    const credentials = join(homeDir, '.config', 'she-test')
    await mkdir(workspace, { recursive: true })
    await mkdir(legacy, { recursive: true })
    await mkdir(credentials, { recursive: true })
    await writeFile(join(workspace, 'README.md'), 'workspace', 'utf8')

    await service.create(sandboxSpec('sbx-host-mount', {
      command: ['sleep', 'infinity'],
      hostMounts: [
        { source: workspace, target: { kind: 'workspace' } },
        { source: legacy, target: { kind: 'legacy' }, readOnly: true },
        { source: credentials, target: { kind: 'home', path: '.config/she-test' }, readOnly: true },
      ],
    }))
    const container = docker.containers.get('she-sbx-host-mount')
    expect(container?.workspacePath).toBe(await realpath(workspace))
    expect(container?.command).toEqual(['sleep', 'infinity'])
    expect(container?.extraMounts).toEqual([
      { source: await realpath(legacy), destination: '/legacy', readOnly: true },
      { source: await realpath(credentials), destination: '/home/agent/.config/she-test', readOnly: true },
    ])
  })

  it('executes one-shot commands inside a running sandbox and records audit metadata', async () => {
    const { dir, docker, service } = await harness()
    await service.create(sandboxSpec('sbx-exec'))
    const result = await service.exec('sbx-exec', {
      command: ['sh', '-lc', 'echo hello'],
      cwd: '/workspace',
      timeoutMs: 5_000,
    })
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ran:sh -lc echo hello' })
    expect(docker.calls).toContain('exec:she-sbx-exec:sh -lc echo hello')
    const audit = await readFile(join(dir, 'broker', 'audit.jsonl'), 'utf8')
    expect(audit).toContain('sandbox.exec')
    expect(audit).toContain('"exitCode":0')

    await expect(service.exec('sbx-exec', { command: [] })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(service.exec('sbx-exec', { command: ['true'], cwd: '/etc' })).rejects.toMatchObject({ code: 'invalid_request' })
    await service.stop('sbx-exec')
    await expect(service.exec('sbx-exec', { command: ['true'] })).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('rejects root and writable credential host mounts', async () => {
    const { service, homeDir } = await harness()
    await expect(service.create(sandboxSpec('sbx-root-mount', {
      hostMounts: [{ source: '/', target: { kind: 'workspace' } }],
    }))).rejects.toMatchObject({ code: 'forbidden' })

    const credentials = join(homeDir, '.config', 'she-test')
    await mkdir(credentials, { recursive: true })
    await expect(service.create(sandboxSpec('sbx-writable-credentials', {
      hostMounts: [{ source: credentials, target: { kind: 'home', path: '.config/she-test' }, readOnly: false }],
    }))).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('serves the broker over a Unix socket via SandboxBrokerClient', async () => {
    const { dir, service } = await harness()
    const socketPath = join(dir, 'broker.sock')
    const server = new BrokerServer({ socketPath, service, token: 'broker-token', brokerVersion: '0.1.0' })
    await server.start()
    cleanup.push(async () => server.close())
    const client = new SandboxBrokerClient({ socketPath, token: 'broker-token' })
    expect(await client.health()).toMatchObject({ provider: 'she-broker', status: 'ok' })
    const created = await client.create(sandboxSpec('sbx-0001'))
    expect(created.name).toBe('sbx-0001')
    const listed = await client.list()
    expect(listed).toHaveLength(1)
    const message = await client.sendMessage({
      messageId: 'msg-socket',
      from: 'main:test',
      to: 'sbx-0001',
      rootTaskId: 'task-socket',
      text: 'ping',
    })
    expect(message.accepted).toBe(true)
    const execResult = await client.exec('sbx-0001', { command: ['sh', '-lc', 'echo via-socket'], cwd: '/workspace' })
    expect(execResult.exitCode).toBe(0)
    await client.destroy('sbx-0001', { preserveData: true })
    expect(await client.inspect('sbx-0001')).toBeUndefined()
  })
})
