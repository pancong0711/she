/**
 * Read-only local AI-agent discovery and migration planning.
 *
 * This module deliberately never reads credential file contents. It only
 * inspects process metadata, listening ports, working directories and whether
 * known config directories exist. Secrets are passed to Docker solely as
 * validated read-only host mount paths by the broker.
 */

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, readlink, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const AGENT_CATALOG = [
  {
    kind: 'opencode',
    name: 'OpenCode',
    match: /(^|[\s/])opencode(?:-ai)?(?:\s|$)/i,
    configPaths: ['~/.config/opencode'],
    credentialLabel: 'OpenCode 配置目录',
  },
  {
    kind: 'claude-code',
    name: 'Claude Code',
    match: /\b(?:claude|claude-code)\b/i,
    configPaths: ['~/.claude', '~/.claude.json'],
    credentialLabel: 'Claude Code 配置',
  },
  {
    kind: 'codex',
    name: 'OpenAI Codex CLI',
    match: /\bcodex(?:-cli)?\b/i,
    configPaths: ['~/.codex'],
    credentialLabel: 'Codex 配置目录',
  },
  {
    kind: 'gemini-cli',
    name: 'Gemini CLI',
    match: /\bgemini(?:-cli)?\b/i,
    configPaths: ['~/.config/gemini', '~/.gemini'],
    credentialLabel: 'Gemini 配置目录',
  },
  {
    kind: 'aider',
    name: 'Aider',
    match: /\baider(?:-chat)?\b/i,
    configPaths: ['~/.aider.conf.yml', '~/.config/aider'],
    credentialLabel: 'Aider 配置',
  },
  {
    kind: 'ollama',
    name: 'Ollama',
    match: /\bollama\b.*\bserve\b/i,
    configPaths: ['~/.ollama'],
    credentialLabel: 'Ollama 模型/配置目录',
  },
  {
    kind: 'lm-studio',
    name: 'LM Studio',
    match: /lm[- ]?studio/i,
    configPaths: ['~/.lmstudio', '~/.config/LM Studio'],
    credentialLabel: 'LM Studio 配置目录',
  },
  {
    kind: 'localai',
    name: 'LocalAI',
    match: /\blocal[-_ ]?ai\b/i,
    configPaths: ['~/.config/localai', '~/.local/share/localai'],
    credentialLabel: 'LocalAI 配置目录',
  },
  {
    kind: 'vllm',
    name: 'vLLM',
    match: /\bvllm\b/i,
    configPaths: ['~/.cache/huggingface'],
    credentialLabel: '模型缓存目录（可能很大）',
  },
  {
    kind: 'llama-cpp',
    name: 'llama.cpp server',
    match: /\b(?:llama-server|llama\.cpp)\b/i,
    configPaths: [],
    credentialLabel: '模型配置',
  },
  {
    kind: 'continue',
    name: 'Continue',
    match: /\bcontinue(?:-server)?\b/i,
    configPaths: ['~/.config/continue'],
    credentialLabel: 'Continue 配置目录',
  },
  {
    kind: 'cursor-agent',
    name: 'Cursor Agent',
    match: /\bcursor-agent\b/i,
    configPaths: ['~/.cursor'],
    credentialLabel: 'Cursor 配置目录',
  },
  {
    kind: 'openhands',
    name: 'OpenHands',
    match: /\bopenhands\b/i,
    configPaths: ['~/.openhands', '~/.config/openhands'],
    credentialLabel: 'OpenHands 配置目录',
  },
  {
    kind: 'goose',
    name: 'Goose',
    match: /\bgoose\b/i,
    configPaths: ['~/.config/goose'],
    credentialLabel: 'Goose 配置目录',
  },
  {
    kind: 'crush',
    name: 'Crush',
    match: /\bcrush\b/i,
    configPaths: ['~/.config/crush'],
    credentialLabel: 'Crush 配置目录',
  },
  {
    kind: 'litellm',
    name: 'LiteLLM proxy',
    match: /\blitellm\b/i,
    configPaths: ['~/.config/litellm', '~/.litellm'],
    credentialLabel: 'LiteLLM 配置目录',
  },
  {
    kind: 'jan',
    name: 'Jan',
    match: /\bjan(?:-server)?\b/i,
    configPaths: ['~/.config/jan', '~/.jan'],
    credentialLabel: 'Jan 配置目录',
  },
  {
    kind: 'open-webui',
    name: 'Open WebUI',
    match: /open[-_ ]?webui/i,
    configPaths: ['~/.open-webui', '~/.config/open-webui'],
    credentialLabel: 'Open WebUI 配置目录',
  },
  {
    kind: 'text-generation-webui',
    name: 'text-generation-webui',
    match: /text[-_ ]generation[-_ ]webui/i,
    configPaths: ['~/.config/text-generation-webui'],
    credentialLabel: 'text-generation-webui 配置目录',
  },
  {
    kind: 'koboldcpp',
    name: 'KoboldCpp',
    match: /\bkoboldcpp\b/i,
    configPaths: ['~/.config/koboldcpp'],
    credentialLabel: 'KoboldCpp 配置目录',
  },
  {
    kind: 'llamafile',
    name: 'llamafile',
    match: /\bllamafile\b/i,
    configPaths: [],
    credentialLabel: 'llamafile 配置',
  },
  {
    kind: 'flowise',
    name: 'Flowise',
    match: /\bflowise\b/i,
    configPaths: ['~/.flowise', '~/.config/flowise'],
    credentialLabel: 'Flowise 配置目录',
  },
  {
    kind: 'langflow',
    name: 'Langflow',
    match: /\blangflow\b/i,
    configPaths: ['~/.langflow', '~/.config/langflow'],
    credentialLabel: 'Langflow 配置目录',
  },
]

const FORBIDDEN_SYSTEM_PATHS = [
  '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/dev',
  '/proc', '/sys', '/run', '/var/run', '/var/lib/docker',
]

const SECRET_ARG_PATTERNS = [
  /((?:--?|\b)[\w.-]*(?:token|secret|password|passwd|credential|api[-_]?key|access[-_]?key|private[-_]?key)[\w.-]*(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,
  /(\bBearer\s+)[^\s]+/gi,
  /(\b(?:sk|gh[pousr]|xox[baprs])-)[A-Za-z0-9._-]{8,}/g,
  /(https?:\/\/[^/\s:@]+:)[^@\s]+(@)/g,
]

export function redactCommand(value) {
  let text = String(value ?? '')
  for (const pattern of SECRET_ARG_PATTERNS) {
    text = text.replace(pattern, (_match, prefix, suffix) => `${prefix}<redacted>${suffix ?? ''}`)
  }
  return text.length > 260 ? `${text.slice(0, 257)}...` : text
}

export function parseProcessList(text) {
  const processes = []
  for (const line of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (line.trim() === '') continue
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid) || pid <= 0) continue
    const comm = match[3] ?? ''
    const args = (match[4] ?? '').trim()
    processes.push({ pid, ppid, comm, args: args === '' ? comm : args })
  }
  return processes
}

export function classifyProcess(processInfo) {
  const haystack = `${processInfo.comm ?? ''} ${processInfo.args ?? ''}`.trim()
  if (haystack === '') return undefined
  // Do not confuse shell/editor commands that merely mention the tool name with
  // a running service.
  if (/^\s*(?:grep|rg|ag|sed|awk|vim?|nvim|less|tail)\b/i.test(haystack)) return undefined
  return AGENT_CATALOG.find(item => item.match.test(haystack))
}

export function parseListeningPorts(ssOutput) {
  const result = new Map()
  for (const line of String(ssOutput ?? '').replace(/\r/g, '').split('\n')) {
    if (!/LISTEN/i.test(line)) continue
    const parts = line.trim().split(/\s+/)
    const localAddress = parts[3]
    const portMatch = /:(\d+)$/.exec(localAddress ?? '')
    if (portMatch === null) continue
    const port = Number(portMatch[1])
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) continue
    const pidMatches = [...line.matchAll(/\bpid=(\d+)/g)]
    for (const pidMatch of pidMatches) {
      const pid = Number(pidMatch[1])
      const ports = result.get(pid) ?? new Set()
      ports.add(port)
      result.set(pid, ports)
    }
  }
  return result
}

function expandHome(value) {
  const text = String(value ?? '').trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return text
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right)
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function isForbiddenWorkspacePath(realPath, home) {
  if (samePath(realPath, parse(realPath).root)) return '文件系统根目录不能作为工作空间'
  if (samePath(realPath, home)) return '用户主目录本身不能作为工作空间'
  if (process.platform !== 'win32') {
    for (const forbidden of FORBIDDEN_SYSTEM_PATHS) {
      if (samePath(realPath, forbidden) || isWithin(forbidden, realPath)) {
        return `受保护的系统路径不能作为工作空间：${forbidden}`
      }
    }
  }
  return undefined
}

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'agent'
}

function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8)
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function capture(command, args, timeout = 5_000) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    })
    return String(stdout)
  } catch {
    return undefined
  }
}

async function listProcesses() {
  const attempts = process.platform === 'win32'
    ? [['tasklist', ['/FO', 'CSV', '/NH']]]
    : [
        ['ps', ['-eo', 'pid=,ppid=,comm=,args=']],
        ['ps', ['-axo', 'pid=,ppid=,comm=,args=']],
      ]
  for (const [command, args] of attempts) {
    const output = await capture(command, args)
    if (output === undefined) continue
    if (process.platform === 'win32') {
      // tasklist does not expose cwd/args; detection there intentionally
      // degrades to config-only inventory instead of guessing credentials.
      const processes = []
      for (const line of output.split('\n')) {
        const match = /^"?([^",]+)"?,\s*(\d+),/.exec(line.trim())
        if (match === null) continue
        const pid = Number(match[2])
        if (!Number.isSafeInteger(pid) || pid <= 0) continue
        processes.push({ pid, ppid: 0, comm: match[1], args: match[1] })
      }
      return processes
    }
    return parseProcessList(output)
  }
  return []
}

async function readProcessCwds(processes) {
  const result = new Map()
  if (process.platform === 'win32') return result
  await Promise.all(processes.map(async processInfo => {
    try {
      result.set(processInfo.pid, await readlink(`/proc/${String(processInfo.pid)}/cwd`))
    } catch {
      // macOS and hardened Linux processes do not expose cwd without lsof.
    }
  }))
  return result
}

async function listListeningPorts() {
  if (process.platform === 'linux') {
    const output = await capture('ss', ['-ltnp'])
    return output === undefined ? new Map() : parseListeningPorts(output)
  }
  return new Map()
}

/**
 * Scan process metadata and known config directories. No file contents are read.
 */
export async function scanLocalAgents() {
  const home = await realpath(homedir()).catch(() => resolve(homedir()))
  const [rawProcesses, portsByPid] = await Promise.all([listProcesses(), listListeningPorts()])
  const processes = rawProcesses.filter(processInfo => processInfo.pid !== process.pid)
  const cwdByPid = await readProcessCwds(processes)
  const runningByKind = new Map()
  const services = []

  for (const processInfo of processes) {
    const definition = classifyProcess(processInfo)
    if (definition === undefined) continue
    if (!runningByKind.has(definition.kind)) runningByKind.set(definition.kind, 0)
    runningByKind.set(definition.kind, runningByKind.get(definition.kind) + 1)
    const cwd = cwdByPid.get(processInfo.pid)
    const warnings = []
    if (cwd === undefined) warnings.push('无法读取进程工作目录，请在迁移配置中手动填写来源路径。')
    else if (isForbiddenWorkspacePath(cwd, home) !== undefined) {
      warnings.push(`${isForbiddenWorkspacePath(cwd, home)}；不能直接复用为容器工作空间。`)
    }
    services.push({
      id: `running:${definition.kind}:${String(processInfo.pid)}`,
      kind: definition.kind,
      name: definition.name,
      running: true,
      pid: processInfo.pid,
      ppid: processInfo.ppid,
      command: redactCommand(processInfo.args),
      ...(cwd === undefined ? {} : { cwd }),
      ports: [...(portsByPid.get(processInfo.pid) ?? [])].sort((a, b) => a - b),
      warnings,
      containerizable: cwd !== undefined && isForbiddenWorkspacePath(cwd, home) === undefined,
    })
  }

  const credentialSuggestions = []
  for (const definition of AGENT_CATALOG) {
    for (const configured of definition.configPaths) {
      const path = expandHome(configured)
      const info = await stat(path).catch(() => undefined)
      if (info === undefined || !info.isDirectory()) continue
      credentialSuggestions.push({
        agentKind: definition.kind,
        label: definition.credentialLabel,
        path,
        exists: true,
      })
    }
  }

  // Installed profiles are useful when the user wants to migrate a service
  // whose runtime is currently stopped. They are never treated as running.
  for (const definition of AGENT_CATALOG) {
    if ((runningByKind.get(definition.kind) ?? 0) > 0) continue
    const existing = credentialSuggestions.find(item => item.agentKind === definition.kind)
    if (existing === undefined) continue
    services.push({
      id: `installed:${definition.kind}`,
      kind: definition.kind,
      name: definition.name,
      running: false,
      pid: null,
      ppid: null,
      command: null,
      ports: [],
      warnings: ['仅检测到配置目录，未检测到运行中的进程；请确认来源工作目录。'],
      containerizable: false,
    })
  }

  services.sort((left, right) => Number(right.running) - Number(left.running) || left.name.localeCompare(right.name))
  return {
    scannedAt: Date.now(),
    platform: process.platform,
    home,
    docker: {
      checked: true,
      available: (await capture('docker', ['version', '--format', '{{.Server.Version}}'])) !== undefined,
    },
    services,
    credentialSuggestions,
    safety: {
      readsProcessMetadataOnly: true,
      readsFileContents: false,
      killsProcesses: false,
      executesSudo: false,
    },
  }
}

function normalizeString(value) {
  return String(value ?? '').trim()
}

function normalizeResources(input) {
  const cpus = input?.cpus === undefined ? 1 : Number(input.cpus)
  const memoryMb = input?.memoryMb === undefined ? 1024 : Number(input.memoryMb)
  const pids = input?.pids === undefined ? 256 : Number(input.pids)
  if (!Number.isFinite(cpus) || cpus <= 0 || cpus > 64) throw new Error('cpus must be between 0 and 64')
  if (!Number.isInteger(memoryMb) || memoryMb < 128 || memoryMb > 131_072) throw new Error('memoryMb must be between 128 and 131072')
  if (!Number.isInteger(pids) || pids < 16 || pids > 16_384) throw new Error('pids must be between 16 and 16384')
  return { cpus, memoryMb, pids }
}

function normalizeCommand(input) {
  const values = Array.isArray(input)
    ? input.map(value => String(value))
    : normalizeString(input).split(/\s+/).filter(Boolean)
  if (values.length === 0) return ['sleep', 'infinity']
  if (values.length > 32) throw new Error('command has too many arguments')
  if (values.some(value => value.includes('\u0000'))) throw new Error('command contains NUL byte')
  return values
}

/**
 * Validate a migration request and return a side-effect-free plan.
 * The caller receives no credential file contents.
 */
export async function buildMigrationPlan({ request, discovery, managedWorkspaceRoot, workspaceAuthorizations = [] }) {
  const home = await realpath(discovery.home ?? homedir()).catch(() => resolve(discovery.home ?? homedir()))
  const errors = []
  const warnings = []
  const selected = Array.isArray(request?.agents) ? request.agents : []
  if (selected.length === 0) errors.push({ code: 'no_agents_selected', message: '至少选择一个 AI agent 服务。' })
  if (selected.length > 8) errors.push({ code: 'too_many_agents', message: '一次最多迁移 8 个服务。' })

  let resources
  try {
    resources = normalizeResources(request?.resources)
  } catch (error) {
    errors.push({ code: 'invalid_resources', message: error.message })
    resources = { cpus: 1, memoryMb: 1024, pids: 256 }
  }

  const image = normalizeString(request?.image) || 'node:22-bookworm-slim'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,299}$/.test(image)) {
    errors.push({ code: 'invalid_image', message: '容器镜像名称不合法。' })
  }
  let command
  try {
    command = normalizeCommand(request?.command)
  } catch (error) {
    errors.push({ code: 'invalid_command', message: error.message })
    command = ['sleep', 'infinity']
  }
  const networkMode = request?.networkMode === 'none' ? 'none' : 'egress'
  if (networkMode === 'egress') {
    warnings.push({ code: 'network-egress', severity: 'warning', message: '容器将使用 bridge 网络访问外部模型/API；如无需要可切换为 none。' })
  }

  const serviceById = new Map((discovery.services ?? []).map(service => [service.id, service]))
  const plannedAgents = []
  const usedSandboxNames = new Set()

  for (const input of selected) {
    const candidateId = normalizeString(input?.id ?? input?.candidateId)
    const service = serviceById.get(candidateId)
    const agentErrors = []
    const agentWarnings = []
    if (service === undefined) {
      errors.push({ code: 'unknown_agent', message: `未找到服务：${candidateId || '(empty)'}`, agentId: candidateId })
      continue
    }
    if (!service.running) {
      agentWarnings.push('该条目不是运行中的服务，仅基于配置目录推断。')
    }

    const workspaceMode = input?.workspaceMode === 'reuse' ? 'reuse' : 'new'
    const legacyReadOnly = workspaceMode === 'new' && input?.legacyReadOnly !== false
    const needsSourceAuthorization = workspaceMode === 'reuse' || legacyReadOnly
    const authorizationId = normalizeString(input?.sourceWorkspaceAuthorizationId)
    const authorization = (workspaceAuthorizations ?? []).find(item => item?.id === authorizationId)
    let sourceReal
    if (needsSourceAuthorization) {
      if (authorizationId === '') {
        agentErrors.push('来源目录必须先加入 Workspaces 授权，并在迁移配置中选择该授权。')
      } else if (authorization === undefined) {
        agentErrors.push(`未找到 workspace 授权：${authorizationId}`)
      } else if (workspaceMode === 'reuse' && authorization.mode !== 'read-write') {
        agentErrors.push('复用原目录需要 read-write workspace 授权。')
      } else if (authorization.exists === false || authorization.leafAuthorized === false) {
        agentErrors.push('所选 workspace 授权已失效或不是允许的叶子目录。')
      } else {
        sourceReal = await realpath(authorization.realPath ?? authorization.path).catch(() => undefined)
        if (sourceReal === undefined) agentErrors.push('所选 workspace 授权目录不存在。')
        else {
          const sourceInfo = await stat(sourceReal).catch(() => undefined)
          if (sourceInfo === undefined || !sourceInfo.isDirectory()) agentErrors.push('所选 workspace 授权必须是目录。')
          const forbidden = isForbiddenWorkspacePath(sourceReal, home)
          if (forbidden !== undefined) agentErrors.push(`${forbidden}；禁止作为工作空间或只读旧目录挂载。`)
        }
      }
    }
    let newWorkspacePath
    if (workspaceMode === 'new') {
      const defaultRoot = resolve(expandHome(managedWorkspaceRoot))
      const requested = normalizeString(input?.newWorkspacePath)
      newWorkspacePath = requested === ''
        ? join(defaultRoot, `${slug(service.kind)}-${shortHash(`${candidateId}:${randomUUID()}`)}`)
        : resolve(expandHome(requested))
      if (!isAbsolute(newWorkspacePath)) {
        agentErrors.push('新工作空间必须是绝对路径。')
      } else {
        const forbidden = isForbiddenWorkspacePath(newWorkspacePath, home)
        if (forbidden !== undefined) agentErrors.push(`${forbidden}；不能作为新工作空间。`)
        if (newWorkspacePath === defaultRoot) agentErrors.push('不能把工作空间根目录本身当作单个工作空间。')
        if (await pathExists(newWorkspacePath)) {
          const existingInfo = await stat(newWorkspacePath).catch(() => undefined)
          if (existingInfo === undefined || !existingInfo.isDirectory()) agentErrors.push('新工作空间路径已存在且不是目录。')
          else {
            const entries = await import('node:fs/promises').then(fs => fs.readdir(newWorkspacePath)).catch(() => ['<unreadable>'])
            if (entries.length > 0) agentErrors.push('新工作空间路径已存在且非空，请换一个路径。')
          }
        }
      }
    }

    const credentialMounts = []
    const credentialInput = Array.isArray(input?.credentialPaths) ? input.credentialPaths : []
    const seenCredentialTargets = new Set()
    for (const credentialValue of credentialInput.slice(0, 16)) {
      const requested = expandHome(normalizeString(credentialValue))
      if (requested === '' || !isAbsolute(requested)) {
        agentErrors.push('凭据挂载必须是绝对路径。')
        continue
      }
      const realCredential = await realpath(requested).catch(() => undefined)
      if (realCredential === undefined) {
        agentErrors.push(`凭据路径不存在：${requested}`)
        continue
      }
      const credentialInfo = await stat(realCredential).catch(() => undefined)
      if (credentialInfo === undefined || !credentialInfo.isDirectory()) {
        agentErrors.push('首版仅支持将配置目录（目录）只读挂载到容器；请选择目录。')
        continue
      }
      if (!isWithin(home, realCredential)) {
        agentErrors.push('凭据目录必须位于用户主目录内，且不能是主目录本身。')
        continue
      }
      const relativeTarget = relative(home, realCredential).split(sep).join('/')
      if (relativeTarget === '' || relativeTarget.split('/').some(segment => segment === '..' || segment === '.' || segment === '')) {
        agentErrors.push('凭据目录无法安全映射到容器 home。')
        continue
      }
      if (seenCredentialTargets.has(relativeTarget)) continue
      seenCredentialTargets.add(relativeTarget)
      credentialMounts.push({
        source: realCredential,
        containerPath: `/home/agent/${relativeTarget}`,
        readOnly: true,
      })
    }

    const sandboxName = `sbx-mig-${slug(service.kind)}-${shortHash(`${candidateId}:${randomUUID()}`)}`.slice(0, 60)
    if (usedSandboxNames.has(sandboxName)) agentErrors.push('生成 sandbox 名称冲突，请重试。')
    usedSandboxNames.add(sandboxName)

    if (agentErrors.length > 0) {
      for (const message of agentErrors) errors.push({ code: 'invalid_agent_settings', message: `${service.name}: ${message}`, agentId: candidateId })
    }
    for (const message of agentWarnings) warnings.push({ code: 'agent-warning', severity: 'warning', message: `${service.name}: ${message}`, agentId: candidateId })
    if (agentErrors.length > 0) continue

    plannedAgents.push({
      candidateId,
      kind: service.kind,
      name: service.name,
      running: service.running,
      pid: service.pid ?? null,
      sourceWorkspacePath: sourceReal ?? '',
      workspaceAuthorizationId: authorization?.id ?? null,
      workspaceMode,
      ...(workspaceMode === 'new' ? { newWorkspacePath } : {}),
      legacyReadOnly,
      credentialMounts,
      sandboxName,
      mounts: [
        ...(workspaceMode === 'reuse' && sourceReal !== undefined
          ? [{ source: sourceReal, target: { kind: 'workspace' }, readOnly: false }]
          : legacyReadOnly && sourceReal !== undefined
            ? [{ source: sourceReal, target: { kind: 'legacy' }, readOnly: true }]
            : []),
        ...credentialMounts.map(mount => ({
          source: mount.source,
          target: { kind: 'home', path: mount.containerPath.slice('/home/agent/'.length) },
          readOnly: true,
        })),
      ],
    })
  }

  if (plannedAgents.length > 0) {
    warnings.push({
      code: 'legacy-process-untouched',
      severity: 'info',
      message: '原 AI agent 进程不会被停止、修改或读取凭据内容；迁移完成后由你确认再手动切换。',
    })
    if (plannedAgents.some(agent => agent.workspaceMode === 'new')) {
      warnings.push({
        code: 'new-workspace-empty',
        severity: 'info',
        message: '“新建工作空间”会创建空目录；原目录仅在勾选时以只读方式挂载到 /legacy。',
      })
    }
    warnings.push({
      code: 'image-must-contain-agent',
      severity: 'warning',
      message: 'SHE 不会自动猜装 agent。请确认镜像内已包含对应 agent runtime，或在容器内手动安装后再切换。',
    })
    warnings.push({
      code: 'credentials-read-only',
      severity: 'info',
      message: '凭据配置目录以只读 bind mount 暴露给容器；SHE 不复制、不读取、不回传密钥内容。',
    })
  }

  const plan = {
    schema: 1,
    id: `mig-${randomUUID()}`,
    createdAt: Date.now(),
    agents: plannedAgents,
    image,
    command,
    networkMode,
    resources,
    warnings,
    errors,
    blocked: errors.length > 0,
    steps: [
      '重新扫描本机进程，确认所选 agent 仍可识别',
      '校验工作空间、旧目录和凭据目录边界',
      '为每个 agent 创建隔离 sandbox，并通过 broker 启动容器',
      '挂载工作空间、/legacy 只读目录和只读凭据目录',
      '保留原进程不动；迁移结果写入本地 migration 记录',
    ],
  }
  return plan
}

export async function discoverAndPlan({ request, managedWorkspaceRoot, workspaceAuthorizations = [] }) {
  const discovery = await scanLocalAgents()
  const plan = await buildMigrationPlan({ request, discovery, managedWorkspaceRoot, workspaceAuthorizations })
  return { discovery, plan }
}
