/** Policy-enforcing sandbox broker service. */

import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path'
import type { SandboxProvider } from '@she/sandbox-sdk'
import type {
  ArtifactRef,
  SandboxEvent,
  SandboxMessageReceipt,
  SandboxMessageRequest,
  SandboxProviderHealth,
  SandboxSpec,
  SandboxStats,
  SandboxView,
} from '@she/protocol'
import { BrokerError } from './errors.js'
import { BrokerAuditLog, BrokerRegistryStore, type BrokerRegistry, type BrokerSandboxRecord } from './registry.js'
import type { DockerExtraMount, DockerInspectResult, DockerRuntime } from './docker-runtime.js'
import { relativeTo, sandboxPaths, safeJoin, assertSafeRelative, assertSandboxName } from './paths.js'

export interface BrokerServiceOptions {
  readonly dataRoot: string
  readonly registryPath: string
  readonly auditPath: string
  readonly docker: DockerRuntime
  readonly mainActorId: string
  readonly brokerVersion?: string
  readonly homeDir?: string
  readonly now?: () => number
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertMessageId(value: string): string {
  if (!/^msg-[a-zA-Z0-9._-]{1,100}$/.test(value)) {
    throw new BrokerError('invalid_request', 'invalid message id')
  }
  return value
}

function mapStatus(inspect: DockerInspectResult): SandboxView['status'] {
  switch (inspect.state) {
    case 'running': return 'running'
    case 'stopped': return 'stopped'
    case 'missing': return 'unknown'
    default: return 'failed'
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

interface ResolvedHostMounts {
  readonly workspacePath: string
  readonly workspaceReadOnly: boolean
  readonly extraMounts: readonly DockerExtraMount[]
}

const FORBIDDEN_SYSTEM_PATHS = [
  '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/dev',
  '/proc', '/sys', '/run', '/var/run', '/var/lib/docker',
]

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right)
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function assertUsableHostSource(realSource: string, home: string): void {
  if (samePath(realSource, parse(realSource).root)) {
    throw new BrokerError('forbidden', 'host mount source must not be a filesystem root')
  }
  if (samePath(realSource, home)) {
    throw new BrokerError('forbidden', 'host mount source must not be the user home directory itself')
  }
  if (process.platform !== 'win32') {
    for (const forbidden of FORBIDDEN_SYSTEM_PATHS) {
      if (samePath(realSource, forbidden) || isWithin(forbidden, realSource)) {
        throw new BrokerError('forbidden', `host mount source is a protected system path: ${forbidden}`)
      }
    }
  }
}

function assertCommand(command: readonly string[] | undefined): readonly string[] | undefined {
  if (command === undefined) return undefined
  if (command.length > 32) throw new BrokerError('invalid_request', 'command has too many arguments')
  let total = 0
  for (const arg of command) {
    if (typeof arg !== 'string' || arg.includes('\u0000')) {
      throw new BrokerError('invalid_request', 'command arguments must be strings without NUL bytes')
    }
    total += Buffer.byteLength(arg)
  }
  if (total > 16 * 1024) throw new BrokerError('invalid_request', 'command is too large')
  return [...command]
}

async function resolveHostMounts(
  mounts: readonly import('@she/protocol').SandboxHostMount[] | undefined,
  defaultWorkspacePath: string,
  homeDir: string,
): Promise<ResolvedHostMounts> {
  if (mounts === undefined || mounts.length === 0) {
    return { workspacePath: defaultWorkspacePath, workspaceReadOnly: false, extraMounts: [] }
  }
  if (mounts.length > 16) throw new BrokerError('invalid_request', 'too many host mounts')
  const home = await realpath(homeDir).catch(() => resolve(homeDir))
  const destinations = new Set<string>(['/workspace', '/inbox', '/outbox', '/home/agent', '/cache', '/tmp'])
  let workspacePath = defaultWorkspacePath
  let workspaceReadOnly = false
  let sawWorkspace = false
  let sawLegacy = false
  const extraMounts: DockerExtraMount[] = []
  for (const mount of mounts) {
    if (typeof mount.source !== 'string' || mount.source.trim() === '' || !isAbsolute(mount.source)) {
      throw new BrokerError('invalid_request', 'host mount source must be an absolute path')
    }
    const realSource = await realpath(mount.source).catch(() => {
      throw new BrokerError('not_found', `host mount source does not exist: ${mount.source}`)
    })
    assertUsableHostSource(realSource, home)
    const info = await stat(realSource)
    if (!info.isDirectory()) throw new BrokerError('invalid_request', 'host mount source must be a directory in v1')
    const readOnly = mount.readOnly !== false
    if (mount.target.kind === 'workspace') {
      if (sawWorkspace) throw new BrokerError('invalid_request', 'only one workspace host mount is allowed')
      sawWorkspace = true
      workspacePath = realSource
      workspaceReadOnly = readOnly
      continue
    }
    if (mount.target.kind === 'legacy') {
      if (sawLegacy) throw new BrokerError('invalid_request', 'only one legacy host mount is allowed')
      if (!readOnly) throw new BrokerError('invalid_request', 'legacy host mount must be read-only')
      sawLegacy = true
      const destination = '/legacy'
      if (destinations.has(destination)) throw new BrokerError('invalid_request', 'duplicate host mount destination')
      destinations.add(destination)
      extraMounts.push({ source: realSource, destination, readOnly: true })
      continue
    }
    if (mount.target.kind !== 'home') throw new BrokerError('invalid_request', 'unknown host mount target')
    if (!isWithin(home, realSource)) throw new BrokerError('forbidden', 'credential host mount source must be inside the user home directory')
    if (!readOnly) throw new BrokerError('invalid_request', 'credential host mounts are read-only in v1')
    const relativeTarget = assertSafeRelative(mount.target.path, 'home mount target')
    const destination = `/home/agent/${relativeTarget}`
    if (destinations.has(destination)) throw new BrokerError('invalid_request', 'duplicate host mount destination')
    destinations.add(destination)
    extraMounts.push({ source: realSource, destination, readOnly: true })
  }
  return { workspacePath, workspaceReadOnly, extraMounts }
}

/**
 * SandboxBrokerService is the only component allowed to call the Docker
 * runtime. It owns the registry, fixed sandbox path template, lifecycle policy
 * and inbox/outbox routing.
 */
export class SandboxBrokerService implements SandboxProvider {
  private readonly now: () => number
  private readonly store: BrokerRegistryStore
  private readonly audit: BrokerAuditLog
  private registry: BrokerRegistry

  constructor(private readonly options: BrokerServiceOptions) {
    this.now = options.now ?? (() => Date.now())
    this.store = new BrokerRegistryStore(options.registryPath)
    this.audit = new BrokerAuditLog(options.auditPath)
    this.registry = { schema: 1, mainActorId: options.mainActorId, sandboxes: [], updatedAt: this.now() }
  }

  async init(): Promise<void> {
    this.registry = await this.store.load(this.options.mainActorId, this.now())
  }

  get registryView(): BrokerRegistry {
    return this.registry
  }

  async health(): Promise<SandboxProviderHealth> {
    const health = await this.options.docker.health()
    return {
      providerId: 'she-broker',
      ok: health.ok,
      ...(health.version === undefined ? {} : { detail: `docker ${health.version}` }),
      checkedAt: this.now(),
    }
  }

  async list(): Promise<readonly SandboxView[]> {
    return await Promise.all(this.registry.sandboxes.map(record => this.viewOf(record)))
  }

  async inspect(name: string): Promise<SandboxView | undefined> {
    const record = this.recordOrUndefined(name)
    return record === undefined ? undefined : this.viewOf(record)
  }

  async create(spec: SandboxSpec): Promise<SandboxView> {
    const name = assertSandboxName(spec.name)
    if (this.registry.sandboxes.some(record => record.name === name)) {
      throw new BrokerError('conflict', `sandbox already exists: ${name}`)
    }
    if (spec.agentId.trim() === '') throw new BrokerError('invalid_request', 'agentId must not be empty')
    if (spec.image.trim() === '') throw new BrokerError('invalid_request', 'image must not be empty')
    const command = assertCommand(spec.command)
    const paths = sandboxPaths(this.options.dataRoot, name)
    const hostMounts = await resolveHostMounts(spec.hostMounts, paths.workspace, this.options.homeDir ?? homedir())
    const allowedCallers = spec.allowedCallers ?? ['main']
    const allowedTargets = spec.allowedTargets ?? []
    for (const value of [...allowedCallers, ...allowedTargets]) {
      if (value !== 'main' && !/^sbx-[a-z0-9][a-z0-9-]{0,59}$/.test(value)) {
        throw new BrokerError('invalid_request', `invalid sandbox actor reference: ${value}`)
      }
    }

    await Promise.all([
      mkdir(paths.root, { recursive: true, mode: 0o700 }),
      mkdir(paths.workspace, { recursive: true, mode: 0o700 }),
      mkdir(paths.inbox, { recursive: true, mode: 0o700 }),
      mkdir(paths.outbox, { recursive: true, mode: 0o700 }),
      mkdir(paths.home, { recursive: true, mode: 0o700 }),
      mkdir(paths.cache, { recursive: true, mode: 0o700 }),
      mkdir(paths.logs, { recursive: true, mode: 0o700 }),
    ])
    await writeFile(paths.descriptor, `${JSON.stringify({ schema: 1, spec, paths }, null, 2)}\n`, { mode: 0o600 })

    const containerName = `she-${name}`
    const networkName = `she-${name}`
    try {
      await this.options.docker.createContainer({
        containerName,
        sandboxName: name,
        role: spec.role,
        image: spec.image,
        networkMode: spec.networkMode,
        workspacePath: hostMounts.workspacePath,
        workspaceReadOnly: hostMounts.workspaceReadOnly,
        inboxPath: paths.inbox,
        outboxPath: paths.outbox,
        homePath: paths.home,
        cachePath: paths.cache,
        ...(spec.resources === undefined ? {} : { resources: spec.resources }),
        ...(spec.labels === undefined ? {} : { labels: spec.labels }),
        ...(hostMounts.extraMounts.length === 0 ? {} : { extraMounts: hostMounts.extraMounts }),
        ...(command === undefined ? {} : { command }),
      })
    } catch (error) {
      await this.options.docker.removeContainer(containerName).catch(() => undefined)
      await rm(paths.root, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    const now = this.now()
    const record: BrokerSandboxRecord = {
      name,
      role: spec.role,
      agentId: spec.agentId,
      image: spec.image,
      containerName,
      networkName,
      paths,
      spec,
      allowedCallers,
      allowedTargets,
      createdAt: now,
      updatedAt: now,
    }
    this.registry = {
      ...this.registry,
      sandboxes: [...this.registry.sandboxes, record],
      updatedAt: now,
    }
    await this.store.save(this.registry)
    await this.audit.append('sandbox.created', { name, role: spec.role, agentId: spec.agentId }, now)
    return this.viewOf(record)
  }

  async start(name: string): Promise<SandboxView> {
    const record = this.requireRecord(name)
    await this.options.docker.start(record.containerName)
    return this.touch(record, 'sandbox.started')
  }

  async stop(name: string): Promise<SandboxView> {
    const record = this.requireRecord(name)
    await this.options.docker.stop(record.containerName)
    return this.touch(record, 'sandbox.stopped')
  }

  async restart(name: string): Promise<SandboxView> {
    const record = this.requireRecord(name)
    await this.options.docker.restart(record.containerName)
    return this.touch(record, 'sandbox.restarted')
  }

  async destroy(name: string, options: { readonly preserveData: boolean }): Promise<void> {
    const record = this.requireRecord(name)
    await this.options.docker.removeContainer(record.containerName)
    await this.options.docker.removeNetwork(record.networkName)
    if (!options.preserveData) await rm(record.paths.root, { recursive: true, force: true })
    const now = this.now()
    this.registry = {
      ...this.registry,
      sandboxes: this.registry.sandboxes.filter(item => item.name !== name),
      updatedAt: now,
    }
    await this.store.save(this.registry)
    await this.audit.append('sandbox.destroyed', { name, preserveData: options.preserveData }, now)
  }

  async stats(name: string): Promise<SandboxStats | undefined> {
    const record = this.requireRecord(name)
    return this.options.docker.stats(record.containerName)
  }

  async sendMessage(message: SandboxMessageRequest): Promise<SandboxMessageReceipt> {
    if (message.from.trim() === '') throw new BrokerError('invalid_request', 'from is required')
    if (message.rootTaskId.trim() === '') throw new BrokerError('invalid_request', 'rootTaskId is required')
    const target = this.requireRecord(message.to)
    if (!(await this.senderAllowed(message.from, target))) {
      throw new BrokerError('forbidden', `sender ${message.from} may not write to ${target.name}`)
    }
    const messageId = assertMessageId(message.messageId || `msg-${randomUUID()}`)
    const messageDir = safeJoin(target.paths.inbox, messageId, 'message id')
    if (await pathExists(messageDir)) throw new BrokerError('message_exists', `message already exists: ${messageId}`)
    const inputDir = safeJoin(messageDir, 'input', 'message input directory')
    await mkdir(inputDir, { recursive: true, mode: 0o700 })

    const sender = message.from === this.registry.mainActorId
      ? undefined
      : this.requireRecord(message.from)
    const artifacts: ArtifactRef[] = []
    const manifestArtifacts: Array<Readonly<Record<string, unknown>>> = []

    for (const [index, artifact] of (message.artifacts ?? []).entries()) {
      if (artifact.fromSandbox !== message.from) {
        throw new BrokerError('forbidden', 'artifact source sandbox must match message sender')
      }
      if (sender === undefined) throw new BrokerError('forbidden', 'main actor has no outbox artifacts')
      const sourceRelative = assertSafeRelative(artifact.fromOutbox, 'fromOutbox')
      const sourceCandidate = safeJoin(sender.paths.outbox, sourceRelative, 'fromOutbox')
      const source = await realpath(sourceCandidate).catch(() => {
        throw new BrokerError('not_found', `artifact source not found: ${sourceRelative}`)
      })
      relativeTo(sender.paths.outbox, source)
      const sourceInfo = await stat(source)
      if (!sourceInfo.isFile()) throw new BrokerError('invalid_request', 'artifact source must be a regular file')
      const targetRelative = assertSafeRelative(artifact.as, 'artifact target')
      const destination = safeJoin(inputDir, targetRelative, 'artifact target')
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      const bytes = await readFile(source)
      await writeFile(destination, bytes, { mode: 0o600 })
      const digest = sha256(bytes)
      artifacts.push({
        id: `${messageId}:${String(index)}`,
        fileName: targetRelative,
        bytes: bytes.byteLength,
        sha256: digest,
      })
      manifestArtifacts.push({
        as: targetRelative,
        fromOutbox: sourceRelative,
        bytes: bytes.byteLength,
        sha256: digest,
      })
    }

    if (message.text !== undefined && message.text !== '') {
      const bytes = Buffer.from(message.text, 'utf8')
      await writeFile(safeJoin(inputDir, 'message.txt', 'message text'), bytes, { mode: 0o600 })
      artifacts.push({
        id: `${messageId}:text`,
        fileName: 'message.txt',
        mediaType: 'text/plain; charset=utf-8',
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      })
    }

    const now = this.now()
    const manifest = {
      schema: 1,
      messageId,
      from: message.from,
      to: target.name,
      rootTaskId: message.rootTaskId,
      ...(message.parentTaskId === undefined ? {} : { parentTaskId: message.parentTaskId }),
      ...(message.handoffDepth === undefined ? {} : { handoffDepth: message.handoffDepth }),
      createdAt: now,
      ...(message.expiresAt === undefined ? {} : { expiresAt: message.expiresAt }),
      artifacts: manifestArtifacts,
    }
    await writeFile(safeJoin(messageDir, 'manifest.json', 'manifest'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    await this.audit.append('message.delivered', {
      messageId,
      from: message.from,
      to: target.name,
      rootTaskId: message.rootTaskId,
      artifacts: artifacts.length,
    }, now)
    return {
      messageId,
      accepted: true,
      manifestPath: `${messageId}/manifest.json`,
      artifacts,
    }
  }

  async *subscribe(_input: { readonly cursor?: string; readonly signal?: AbortSignal }): AsyncIterable<SandboxEvent> {
    return
  }

  private async senderAllowed(from: string, target: BrokerSandboxRecord): Promise<boolean> {
    if (from === this.registry.mainActorId) {
      return target.allowedCallers.includes('main') || target.allowedCallers.includes(this.registry.mainActorId)
    }
    const sender = this.registry.sandboxes.find(record => record.name === from)
    if (sender === undefined) return false
    return target.allowedCallers.includes(from) && sender.allowedTargets.includes(target.name)
  }

  private requireRecord(name: string): BrokerSandboxRecord {
    const record = this.recordOrUndefined(name)
    if (record === undefined) throw new BrokerError('not_found', `sandbox not found: ${name}`)
    return record
  }

  private recordOrUndefined(name: string): BrokerSandboxRecord | undefined {
    return this.registry.sandboxes.find(record => record.name === name)
  }

  private async touch(record: BrokerSandboxRecord, action: string): Promise<SandboxView> {
    const now = this.now()
    const updated = { ...record, updatedAt: now }
    this.registry = {
      ...this.registry,
      sandboxes: this.registry.sandboxes.map(item => item.name === record.name ? updated : item),
      updatedAt: now,
    }
    await this.store.save(this.registry)
    await this.audit.append(action, { name: record.name }, now)
    return this.viewOf(updated)
  }

  private async viewOf(record: BrokerSandboxRecord): Promise<SandboxView> {
    const inspect = await this.options.docker.inspect(record.containerName)
    return {
      name: record.name,
      role: record.role,
      agentId: record.agentId,
      status: mapStatus(inspect),
      image: record.image,
      createdAt: record.createdAt,
      ...(inspect.startedAt === undefined ? {} : { startedAt: inspect.startedAt }),
      health: inspect.state === 'running' ? 'ok' : inspect.state === 'unknown' ? 'unknown' : 'degraded',
      ...(record.spec.labels === undefined ? {} : { labels: record.spec.labels }),
    }
  }
}
