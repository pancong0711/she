import type {
  AgentRuntimeStatus,
  ArtifactListItem,
  GatewayHealth,
  GatewaySnapshot,
  SandboxBrokerHealth,
  SandboxExecRequest,
  SandboxExecResult,
  SandboxSpec,
  SandboxStats,
  SandboxView,
} from '@she/protocol'

export interface SnapshotResult {
  readonly health: GatewayHealth
  readonly snapshot: GatewaySnapshot
}

export interface SandboxResult {
  readonly health: SandboxBrokerHealth
  readonly sandboxes: readonly SandboxView[]
}

const COMPANION_KEY = 'she.companionUrl'
export const DEFAULT_COMPANION_URL = 'http://127.0.0.1:8787'

export function isLocalOrigin(): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
}

export function getCompanionUrl(): string {
  return localStorage.getItem(COMPANION_KEY)?.trim() || DEFAULT_COMPANION_URL
}

export function setCompanionUrl(value: string): void {
  const normalized = value.trim().replace(/\/+$/, '')
  if (normalized === '') localStorage.removeItem(COMPANION_KEY)
  else localStorage.setItem(COMPANION_KEY, normalized)
}

export function apiBase(): string {
  return isLocalOrigin() ? '' : getCompanionUrl().replace(/\/+$/, '')
}

export function brokerBase(): string {
  return '/broker'
}

function companionTargetLabel(): string {
  return isLocalOrigin() ? window.location.origin : (apiBase() || DEFAULT_COMPANION_URL)
}

function companionNetworkError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error)
  return new Error(
    `无法连接本地 companion（${companionTargetLabel()}）：${detail}。`
    + '请确认 companion v0.7.9+ 正在运行；从 GitHub Pages 首次访问时，请在浏览器提示中允许“本地网络访问”，并确认没有拦截 http://127.0.0.1 的 HTTPS→HTTP 请求。',
  )
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase()}${path}`, {
      // `cache-control` is not a CORS-safelisted request header. Omitting it
      // prevents an unnecessary cross-origin preflight on every read.
      headers: { accept: 'application/json' },
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (cause) {
    throw companionNetworkError(cause)
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
  return await response.json() as T
}

async function getResult<T>(path: string, signal?: AbortSignal): Promise<T> {
  const payload = await getJson<{ ok: boolean; value?: T; error?: { message?: string } }>(path, signal)
  if (!payload.ok) throw new Error(payload.error?.message ?? 'SHE request failed')
  return payload.value as T
}

export async function loadSnapshot(signal?: AbortSignal): Promise<SnapshotResult> {
  const [health, snapshot] = await Promise.all([
    getJson<GatewayHealth>('/v1/health', signal),
    getResult<GatewaySnapshot>('/v1/snapshot', signal),
  ])
  return { health, snapshot }
}

export async function loadTaskArtifacts(taskId: string, signal?: AbortSignal): Promise<readonly ArtifactListItem[]> {
  return await getResult<readonly ArtifactListItem[]>(`/v1/artifacts?taskId=${encodeURIComponent(taskId)}`, signal)
}

export function artifactDownloadUrl(artifactId: string): string {
  return `${apiBase()}/v1/artifacts/${encodeURIComponent(artifactId)}/download`
}

export async function loadArtifactText(artifactId: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(artifactDownloadUrl(artifactId), {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`artifact download failed: HTTP ${response.status}`)
  return await response.text()
}

export async function loadAgentRuntime(signal?: AbortSignal): Promise<AgentRuntimeStatus> {
  return await getResult<AgentRuntimeStatus>('/v1/agents', signal)
}

export async function loadSandboxes(signal?: AbortSignal): Promise<SandboxResult> {
  const [health, sandboxes] = await Promise.all([
    getJson<SandboxBrokerHealth>(`${brokerBase()}/v1/health`, signal),
    getResult<readonly SandboxView[]>(`${brokerBase()}/v1/sandboxes`, signal),
  ])
  return { health, sandboxes }
}

export async function createSandbox(spec: SandboxSpec): Promise<SandboxView> {
  const response = await fetch(`${apiBase()}${brokerBase()}/v1/sandboxes`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(spec),
  })
  const payload = await response.json() as { ok: boolean; value?: SandboxView; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `sandbox create failed: HTTP ${response.status}`)
  }
  return payload.value
}

export async function execSandbox(name: string, request: SandboxExecRequest): Promise<SandboxExecResult> {
  const response = await fetch(`${apiBase()}${brokerBase()}/v1/sandboxes/${encodeURIComponent(name)}/exec`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const payload = await response.json() as { ok: boolean; value?: SandboxExecResult; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `sandbox exec failed: HTTP ${response.status}`)
  }
  return payload.value
}

export interface SandboxAgentRecipeCommand {
  readonly command: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
}

export interface SandboxAgentRecipe {
  readonly schema: 1
  readonly id: string
  readonly label: string
  readonly description: string
  readonly packageName: string
  readonly version: string
  readonly binary: string
  readonly image: string
  readonly networkMode: 'none' | 'egress'
  readonly requirements: readonly string[]
  readonly notes: readonly string[]
  readonly knownVersions: readonly string[]
  readonly install: SandboxAgentRecipeCommand
  readonly verify: SandboxAgentRecipeCommand
  readonly bootstrap: SandboxAgentRecipeCommand
  readonly exampleCommand?: string
  readonly installedVersions?: readonly { readonly version: string; readonly installedAt: number; readonly sandboxName?: string }[]
}

export interface SandboxAgentVersionResolution {
  readonly schema: 1
  readonly agentId: string
  readonly packageName: string
  readonly requested: string
  readonly resolved: string
  readonly exact: boolean
  readonly fallback: boolean
  readonly verified: boolean
  readonly registry: string | null
  readonly latest: string
  readonly availableVersions: readonly string[]
  readonly warning?: string
  readonly recipe: SandboxAgentRecipe
}

export async function resolveSandboxAgentVersion(agentId: string, version: string, signal?: AbortSignal): Promise<SandboxAgentVersionResolution> {
  const params = new URLSearchParams({ agentId, version })
  const payload = await getJson<{ ok: boolean; value?: SandboxAgentVersionResolution; error?: { message?: string } }>(`/api/sandbox/agent-recipes/resolve?${params.toString()}`, signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'agent version resolution failed')
  return payload.value
}

export async function recordSandboxAgentInstall(input: { agentId: string; version: string; success: boolean; sandboxName?: string }): Promise<void> {
  const response = await fetch(`${apiBase()}/api/sandbox/agent-recipes/record-install`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify(input),
  })
  const payload = await response.json() as { ok: boolean; error?: { message?: string } }
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? `agent install record failed: HTTP ${response.status}`)
}

export async function loadSandboxAgentRecipes(signal?: AbortSignal): Promise<readonly SandboxAgentRecipe[]> {
  const payload = await getJson<{ ok: boolean; value?: readonly SandboxAgentRecipe[]; error?: { message?: string } }>('/api/sandbox/agent-recipes', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'sandbox agent recipes unavailable')
  return payload.value
}

export async function loadSandboxStats(name: string, signal?: AbortSignal): Promise<SandboxStats | undefined> {
  const value = await getResult<SandboxStats | null>(
    `${brokerBase()}/v1/sandboxes/${encodeURIComponent(name)}/stats`,
    signal,
  )
  return value ?? undefined
}

export const INSTALL_COMMANDS = [
  'git clone https://github.com/pancong0711/she.git',
  'cd she',
  'pnpm install',
  'pnpm pwa:build',
  'pnpm pwa:serve',
]

export const BROKER_COMMANDS = [
  '# 另开终端启动 sandbox broker',
  'pnpm broker',
]

export const REPO_URL = 'https://github.com/pancong0711/she'

export interface CompanionHealth {
  readonly status: 'ok'
  readonly pid: number
  readonly repoRoot: string
  readonly distDir: string
  readonly controlSocketPath: string
  readonly brokerSocketPath: string
  readonly activeJobId: string | null
  readonly version: string
  readonly supervised?: boolean
  readonly sourceCheckout?: boolean
  readonly installRoot?: string
  readonly launcherVersion?: string
  readonly launcherInstalled?: boolean
}

export interface JobSummary {
  readonly id: string
  readonly kind: string
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed'
  readonly createdAt: number
  readonly startedAt: number | null
  readonly finishedAt: number | null
  readonly exitCode: number | null
}

export type JobEvent =
  | { readonly at: number; readonly type: 'log'; readonly stream: 'stdout' | 'stderr'; readonly text: string }
  | { readonly at: number; readonly type: 'system'; readonly text: string }
  | {
      readonly at: number
      readonly type: 'check'
      readonly status: 'ok' | 'warn' | 'fail'
      readonly label: string
      readonly detail: string
      readonly requirement?: 'required' | 'recommended' | 'sandbox' | 'runtime' | 'development' | string
      readonly feature?: string
      readonly remediation?: string
    }
  | { readonly at: number; readonly type: 'status'; readonly status: JobSummary['status'] }
  | { readonly at: number; readonly type: 'done'; readonly status: JobSummary['status']; readonly exitCode: number }

export async function loadCompanionHealth(signal?: AbortSignal): Promise<CompanionHealth> {
  const payload = await getJson<{ ok: boolean; value?: CompanionHealth; error?: { message?: string } }>('/api/health', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'companion unavailable')
  return payload.value
}

export interface SandboxImagePreset {
  readonly id: string
  readonly label: string
  readonly image: string
  readonly description: string
}

export interface SandboxImageSource {
  readonly id: string
  readonly label: string
  readonly registryPrefix: string | null
  readonly description: string
}

export interface SandboxPreferences {
  readonly schema: 1
  readonly defaultImage: string
  readonly imageSource: string
  readonly networkMode: 'none' | 'egress'
  readonly resources: { readonly cpus: number; readonly memoryMb: number; readonly pids: number }
}

export interface SandboxPreferencesResponse {
  readonly path: string
  readonly config: SandboxPreferences
  readonly catalog: readonly SandboxImagePreset[]
  readonly imageSources: readonly SandboxImageSource[]
  readonly localImages: readonly string[]
}

/**
 * Resolve a Docker Hub image through a selected mirror source. Full references
 * to another registry are kept as-is because Docker Hub mirrors cannot serve
 * arbitrary registries.
 */
export function resolveSandboxImage(image: string, source: SandboxImageSource | undefined): string {
  const text = image.trim()
  const prefix = source?.registryPrefix?.trim().replace(/\/+$/, '') ?? ''
  if (text === '' || prefix === '') return text
  const dockerHubReference = text.replace(/^(?:docker\.io|index\.docker\.io)\//, '')
  const stripped = dockerHubReference !== text
  const [first = '', ...rest] = dockerHubReference.split('/')
  const firstLooksLikeRegistry = rest.length > 0 && (first.includes('.') || first.includes(':') || first === 'localhost')
  if (!stripped && firstLooksLikeRegistry) return text
  const repository = rest.length === 0 ? `library/${first}` : [first, ...rest].join('/')
  return `${prefix}/${repository}`
}

export async function loadSandboxPreferences(signal?: AbortSignal): Promise<SandboxPreferencesResponse> {
  const payload = await getJson<{ ok: boolean; value?: SandboxPreferencesResponse; error?: { message?: string } }>('/api/sandbox/preferences', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'sandbox preferences unavailable')
  return payload.value
}

export async function saveSandboxPreferences(input: SandboxPreferences): Promise<SandboxPreferencesResponse> {
  const response = await fetch(`${apiBase()}/api/sandbox/preferences`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify(input),
  })
  const payload = await response.json() as { ok: boolean; value?: SandboxPreferencesResponse; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `sandbox preferences save failed: HTTP ${response.status}`)
  }
  return payload.value
}

export interface FeishuGatewayStatus {
  readonly schema: 1
  readonly checkedAt: number
  readonly envFile: {
    readonly path: string
    readonly exists: boolean
    readonly mode?: number
    readonly permissionsOk?: boolean
    readonly appId: string
    readonly appIdConfigured: boolean
    readonly appSecretConfigured: boolean
    readonly domain: 'feishu' | 'lark'
    readonly requireMention: boolean
    readonly allowedOpenIds: string
    readonly allowedChatIds: string
  }
  readonly runtime: {
    readonly entry: string
    readonly entryExists: boolean
    readonly running: boolean
    readonly pid: number | null
    readonly startedAt: number | null
    readonly lastError: string | null
    readonly logs: readonly { readonly at: number; readonly stream: string; readonly text: string }[]
  }
  readonly note: string
}

export async function loadFeishuGatewayStatus(signal?: AbortSignal): Promise<FeishuGatewayStatus> {
  const payload = await getJson<{ ok: boolean; value?: FeishuGatewayStatus; error?: { message?: string } }>('/api/feishu/gateway/status', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'Feishu gateway status unavailable')
  return payload.value
}

export interface FeishuGatewayConfigInput {
  readonly appId: string
  readonly appSecret: string
  readonly domain: 'feishu' | 'lark'
  readonly requireMention: boolean
  readonly allowedOpenIds: string
  readonly allowedChatIds: string
}

export async function saveFeishuGatewayConfig(input: FeishuGatewayConfigInput): Promise<FeishuGatewayStatus> {
  const response = await fetch(`${apiBase()}/api/feishu/gateway/config`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify(input),
  })
  const payload = await response.json() as { ok: boolean; value?: FeishuGatewayStatus; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `Feishu gateway config failed: HTTP ${response.status}`)
  }
  return payload.value
}

export async function controlFeishuGateway(action: 'start' | 'stop'): Promise<FeishuGatewayStatus> {
  const response = await fetch(`${apiBase()}/api/feishu/gateway/${action}`, {
    method: 'POST',
    headers: localActionHeaders(),
  })
  const payload = await response.json() as { ok: boolean; value?: FeishuGatewayStatus; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `Feishu gateway ${action} failed: HTTP ${response.status}`)
  }
  return payload.value
}

export const FEISHU4DSH_SOURCE_URL = 'git+https://github.com/pancong0711/feishu4dsh.git'

export interface Feishu4dshStatus {
  readonly schema: 1
  readonly checkedAt: number
  readonly dsh: {
    readonly command: string
    readonly available: boolean
    readonly version: string | null
    readonly detail?: string
  }
  readonly profile: {
    readonly name: string
    readonly directory: string
    readonly packageFile: string
    readonly initialized: boolean
    readonly pluginInstalled: boolean
    readonly dependencySpec: string | null
  }
  readonly envFile: {
    readonly path: string
    readonly exists: boolean
    readonly mode?: number
    readonly appIdConfigured: boolean
    readonly appSecretConfigured: boolean
    readonly permissionsOk?: boolean
    readonly note: string
  }
  readonly service: {
    readonly unitExists: boolean
    readonly enabled: boolean
    readonly active: boolean
    readonly systemdAvailable: boolean
    readonly detail?: string
  }
  readonly prerequisitesReady: boolean
  readonly commands: {
    readonly installPlugin: string
    readonly installService: string
    readonly enableService: string
    readonly logs: string
  }
  readonly notes: readonly string[]
}

export async function loadFeishu4dshStatus(signal?: AbortSignal): Promise<Feishu4dshStatus> {
  const payload = await getJson<{ ok: boolean; value?: Feishu4dshStatus; error?: { message?: string } }>('/api/feishu4dsh', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'feishu4dsh status unavailable')
  return payload.value
}

export interface GatewayConfig {
  readonly schema: 1
  readonly channel: 'feishu4dsh'
  readonly enabled: boolean
  readonly adapterHealthUrl: string
  readonly secretBoundary: 'external-only'
}

export interface GatewayStatus {
  readonly schema: 1
  readonly checkedAt: number
  readonly config: GatewayConfig
  readonly controlPlane: {
    readonly reachable: boolean
    readonly httpStatus?: number
    readonly response?: unknown
    readonly error?: string
  }
  readonly adapter: {
    readonly configured: boolean
    readonly reachable: boolean
    readonly httpStatus?: number
    readonly detail?: string
    readonly response?: unknown
  }
  readonly secretBoundary: {
    readonly owner: string
    readonly sheReadsSecrets: boolean
    readonly note: string
  }
}

export async function loadGatewayStatus(signal?: AbortSignal): Promise<GatewayStatus> {
  const payload = await getJson<{ ok: boolean; value?: GatewayStatus; error?: { message?: string } }>('/api/gateway', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'gateway status unavailable')
  return payload.value
}

export async function saveGatewayConfig(input: { enabled: boolean; adapterHealthUrl: string }): Promise<GatewayStatus> {
  const response = await fetch(`${apiBase()}/api/gateway`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify(input),
  })
  const payload = await response.json() as { ok: boolean; value?: GatewayStatus; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `gateway config save failed: HTTP ${response.status}`)
  }
  return payload.value
}

export interface AutostartStatus {
  readonly enabled: boolean
  readonly mode: 'systemd-user' | 'xdg-autostart' | 'launch-agent' | 'windows-startup' | 'disabled' | 'unsupported' | string
  readonly path: string | null
  readonly note: string
}

export async function loadAutostart(signal?: AbortSignal): Promise<AutostartStatus> {
  const payload = await getJson<{ ok: boolean; value?: AutostartStatus; error?: { message?: string } }>('/api/autostart', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'autostart status unavailable')
  return payload.value
}

export async function setAutostart(enabled: boolean): Promise<AutostartStatus> {
  const response = await fetch(`${apiBase()}/api/autostart`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify({ enabled }),
  })
  const payload = await response.json() as { ok: boolean; value?: AutostartStatus; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `autostart update failed: HTTP ${response.status}`)
  }
  return payload.value
}

export interface CompanionUpdateCheck {
  readonly current: string
  readonly available: string
  readonly needsUpdate: boolean
  readonly manifest: unknown
}

async function companionAction(action: 'restart' | 'shutdown'): Promise<void> {
  const response = await fetch(`${apiBase()}/api/companion/${action}`, {
    method: 'POST',
    headers: localActionHeaders(),
  })
  const payload = await response.json() as { ok: boolean; error?: { message?: string } }
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? `companion ${action} failed: HTTP ${response.status}`)
}

export async function restartCompanion(): Promise<void> {
  await companionAction('restart')
}

export async function shutdownCompanion(): Promise<void> {
  await companionAction('shutdown')
}

export async function checkCompanionUpdate(manifestUrl: string): Promise<CompanionUpdateCheck> {
  const response = await fetch(`${apiBase()}/api/companion/update/check`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify({ manifestUrl }),
  })
  const payload = await response.json() as { ok: boolean; value?: CompanionUpdateCheck; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `companion update check failed: HTTP ${response.status}`)
  }
  return payload.value
}

export async function applyCompanionUpdate(manifestUrl: string): Promise<{ from: string; to: string; restarting: boolean }> {
  const response = await fetch(`${apiBase()}/api/companion/update/apply`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify({ manifestUrl }),
  })
  const payload = await response.json() as { ok: boolean; value?: { from: string; to: string; restarting: boolean }; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `companion update failed: HTTP ${response.status}`)
  }
  return payload.value
}

export async function startJob(kind: string, options: Readonly<Record<string, unknown>> = {}): Promise<JobSummary> {
  const response = await fetch(`${apiBase()}/api/jobs`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-she-local-action': '1',
    },
    body: JSON.stringify({ kind, ...options }),
  })
  const payload = await response.json() as { ok: boolean; value?: JobSummary; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `job start failed: HTTP ${response.status}`)
  }
  return payload.value
}

export async function* streamJobEvents(jobId: string, signal?: AbortSignal): AsyncIterable<JobEvent> {
  const response = await fetch(`${apiBase()}/api/jobs/${encodeURIComponent(jobId)}/events`, {
    headers: { accept: 'application/x-ndjson' },
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  if (response.body === null) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line !== '') yield JSON.parse(line) as JobEvent
        newline = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail !== '') yield JSON.parse(tail) as JobEvent
  } finally {
    reader.releaseLock()
  }
}

export interface PreflightCheck {
  readonly type: 'check'
  readonly status: 'ok' | 'warn' | 'fail'
  readonly label: string
  readonly detail: string
  readonly requirement: 'required' | 'recommended' | 'sandbox' | 'runtime' | 'development' | string
  readonly feature?: string
  readonly remediation?: string
}

export interface PreflightResult {
  readonly at: number | null
  readonly ok: boolean | null
  readonly sandboxReady?: boolean
  readonly persistenceReady?: boolean
  readonly checks: readonly PreflightCheck[]
  readonly warnings?: readonly PreflightCheck[]
  readonly summary?: {
    readonly requiredReady: boolean
    readonly sandboxReady: boolean
    readonly persistenceReady?: boolean
    readonly warnings: number
    readonly failures: number
  }
}

export async function loadPreflight(signal?: AbortSignal): Promise<PreflightResult> {
  const payload = await getJson<{ ok: boolean; value?: PreflightResult; error?: { message?: string } }>('/api/preflight', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'preflight unavailable')
  return payload.value
}

export interface WorkspaceAuthorization {
  readonly id: string
  readonly label: string
  readonly path: string
  readonly realPath: string
  readonly mode: 'read-only' | 'read-write'
  readonly authorizedAt: number
  readonly exists: boolean
  readonly isDirectory: boolean
  readonly readable: boolean
  readonly writable: boolean
  readonly leafAuthorized: boolean
  readonly warnings: readonly string[]
}

export interface WorkspaceListResponse {
  readonly path: string
  readonly workspaces: readonly WorkspaceAuthorization[]
}

export async function loadWorkspaces(signal?: AbortSignal): Promise<WorkspaceListResponse> {
  const payload = await getJson<{ ok: boolean; value?: WorkspaceListResponse; error?: { message?: string } }>('/api/workspaces', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'workspace list unavailable')
  return payload.value
}

export async function authorizeWorkspace(input: {
  readonly label: string
  readonly path: string
  readonly mode: 'read-only' | 'read-write'
}): Promise<WorkspaceListResponse> {
  const response = await fetch(`${apiBase()}/api/workspaces`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify(input),
  })
  const payload = await response.json() as { ok: boolean; value?: WorkspaceListResponse; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `workspace authorization failed: HTTP ${response.status}`)
  }
  return payload.value
}

export async function removeWorkspace(id: string): Promise<WorkspaceListResponse> {
  const response = await fetch(`${apiBase()}/api/workspaces/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: localActionHeaders(),
  })
  const payload = await response.json() as { ok: boolean; value?: WorkspaceListResponse; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `workspace removal failed: HTTP ${response.status}`)
  }
  return payload.value
}

export interface PlatformSupportRow {
  readonly feature: string
  readonly linux: string
  readonly macos: string
  readonly windows: string
}

export interface PlatformStatus {
  readonly schema: 1
  readonly checkedAt: number
  readonly runtime: {
    readonly platform: string
    readonly arch: string
    readonly release: string
    readonly node: string
    readonly uid: number | null
    readonly home: string
    readonly shell: string
    readonly wsl: boolean
    readonly distro?: string | null
    readonly pathSeparator: string
  }
  readonly docker: {
    readonly available: boolean
    readonly mode: string
    readonly version?: string
    readonly install?: PackageInstallInfo
  }
  readonly capabilities: Readonly<Record<string, boolean>>
  readonly supportMatrix: readonly PlatformSupportRow[]
  readonly notes: readonly string[]
}

export async function loadPlatformStatus(signal?: AbortSignal): Promise<PlatformStatus> {
  const payload = await getJson<{ ok: boolean; value?: PlatformStatus; error?: { message?: string } }>('/api/platform', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'platform status unavailable')
  return payload.value
}

export interface CoreStatus {
  readonly companion: string
  readonly supervisor: {
    readonly state: 'running' | 'stopped'
    readonly external?: boolean
    readonly pid: number | null
    readonly startedAt: number | null
    readonly lastError: string | null
    readonly logs: readonly { readonly at: number; readonly stream: string; readonly text: string }[]
  }
  readonly installed: {
    readonly root: string
    readonly current: string | null
    readonly currentTarget: string | null
    readonly previous: string | null
    readonly previousTarget: string | null
  }
  readonly controlPlane: { readonly reachable: boolean; readonly httpStatus?: number; readonly response?: unknown; readonly error?: string }
  readonly broker: { readonly reachable: boolean; readonly httpStatus?: number; readonly response?: unknown; readonly error?: string }
  readonly lastUpdate: {
    readonly at: number
    readonly manifestUrl: string
    readonly from: string | null
    readonly to: string
    readonly status: string
  } | null
}

export interface CoreUpdateCheck {
  readonly current: string | null
  readonly available: string | null
  readonly needsUpdate: boolean
  readonly manifest: unknown
}

export const DEFAULT_CORE_MANIFEST_URL = 'https://github.com/pancong0711/she/releases/download/v0.3.2-core.1/release-manifest.json'

export const COMPANION_RELEASE_VERSION = '0.7.9'
export const PWA_BUILD_VERSION = COMPANION_RELEASE_VERSION
export const COMPANION_MIN_VERSION = '0.7.9'
export const COMPANION_RELEASE_TAG = 'v0.7.9-companion.1'
export const COMPANION_RELEASE_URL = `https://github.com/pancong0711/she/releases/tag/${COMPANION_RELEASE_TAG}`
export const COMPANION_MANIFEST_URL = 'https://pancong0711.github.io/she/companion-release-manifest.json'
export const COMPANION_BUNDLE_URL = `https://github.com/pancong0711/she/releases/download/${COMPANION_RELEASE_TAG}/she-companion-${COMPANION_RELEASE_VERSION}.tar.gz`
export const COMPANION_INSTALLER_URL = `https://github.com/pancong0711/she/releases/download/${COMPANION_RELEASE_TAG}/install-companion.sh`

function localActionHeaders(): Record<string, string> {
  return { accept: 'application/json', 'content-type': 'application/json', 'x-she-local-action': '1' }
}

export async function loadCoreStatus(signal?: AbortSignal): Promise<CoreStatus> {
  const payload = await getJson<{ ok: boolean; value?: CoreStatus; error?: { message?: string } }>('/api/core/status', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'core status unavailable')
  return payload.value
}

export interface CoreActionResult {
  readonly action: 'start' | 'stop' | 'restart'
  readonly health: {
    readonly ok?: boolean
    readonly external?: boolean
    readonly control?: unknown
    readonly broker?: unknown
    readonly error?: string
  }
  readonly status: CoreStatus
}

export async function coreAction(action: 'start' | 'stop' | 'restart'): Promise<CoreActionResult> {
  const response = await fetch(`${apiBase()}/api/core/${action}`, {
    method: 'POST',
    headers: localActionHeaders(),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json() as { ok: boolean; value?: CoreActionResult; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value?.status === undefined) {
    throw new Error(payload.error?.message ?? `core action failed: HTTP ${response.status}`)
  }
  return payload.value
}

export async function checkCoreUpdate(manifestUrl: string): Promise<CoreUpdateCheck> {
  const response = await fetch(`${apiBase()}/api/core/update/check`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify({ manifestUrl }),
  })
  const payload = await response.json() as { ok: boolean; value?: CoreUpdateCheck; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `update check failed: HTTP ${response.status}`)
  }
  return payload.value
}

export interface PackageInstallStep {
  readonly command: string
  readonly explanation: string
  readonly requiresRoot?: boolean
  readonly optional?: boolean
  readonly note?: string
}

export interface PackageInstallAlternative {
  readonly label: string
  readonly steps: readonly PackageInstallStep[]
}

export interface PackageInstallInfo {
  readonly mode: 'managed' | 'user-local' | 'instructions-only' | 'external' | string
  readonly title: string
  readonly commands: readonly string[]
  readonly steps?: readonly PackageInstallStep[]
  readonly alternatives?: readonly PackageInstallAlternative[]
  readonly url?: string
  readonly note: string
}

export interface PackageInfo {
  readonly id: string
  readonly name: string
  readonly kind: 'component' | 'core' | 'runtime' | 'tool' | 'agent' | string
  readonly installedVersion: string | null
  readonly previousVersion?: string | null
  readonly state: string
  readonly requirement?: 'required' | 'recommended' | 'sandbox' | 'optional' | string
  readonly requiredFor?: readonly string[]
  readonly management: 'launcher' | 'core-update' | 'bootstrap' | 'instructions-only' | 'external' | string
  readonly manifestUrl?: string
  readonly note: string
  readonly install?: PackageInstallInfo
}

export function isVersionOlder(current: string | undefined, minimum: string): boolean {
  if (current === undefined) return true
  const parse = (value: string): number[] => value.replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0)
  const left = parse(current)
  const right = parse(minimum)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a < b
  }
  return false
}

export async function loadPackages(signal?: AbortSignal): Promise<readonly PackageInfo[]> {
  const payload = await getJson<{ ok: boolean; value?: readonly PackageInfo[]; error?: { message?: string } }>('/api/packages', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'package catalog unavailable')
  return payload.value
}

import type {
  GatewayCommandInvocation,
  GatewayCommandRequest,
  GatewayCommandResult,
  GatewayServerEvent,
} from '@she/protocol'
import { GATEWAY_PROTOCOL_VERSION } from '@she/protocol'

export const PWA_CONVERSATION_ID = 'pwa:local'

export async function sendTaskToShe(text: string): Promise<GatewayCommandResult> {
  const command: GatewayCommandInvocation = {
    kind: 'command',
    requestId: crypto.randomUUID(),
    actor: { id: 'pwa:local-user', kind: 'user' },
    conversation: { id: PWA_CONVERSATION_ID, kind: 'api' },
    workspaceKey: 'pwa',
    rawCommand: `/she submit ${text}`,
  }
  const body: GatewayCommandRequest = { protocolVersion: GATEWAY_PROTOCOL_VERSION, command }
  const response = await fetch(`${apiBase()}/v1/commands`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { ok: boolean; value?: GatewayCommandResult; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `command failed: HTTP ${response.status}`)
  }
  return payload.value
}

export async function* subscribeGatewayEvents(signal?: AbortSignal): AsyncIterable<GatewayServerEvent> {
  const response = await fetch(`${apiBase()}/v1/events`, {
    headers: { accept: 'application/x-ndjson' },
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`event stream HTTP ${response.status}: ${await response.text()}`)
  if (response.body === null) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line !== '') yield JSON.parse(line) as GatewayServerEvent
        newline = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail !== '') yield JSON.parse(tail) as GatewayServerEvent
  } finally {
    reader.releaseLock()
  }
}

export interface WorkerModelConfig {
  readonly providerId: string
  readonly modelId: string
  readonly variant?: string
}

export interface OpenCodeServiceStatus {
  readonly schema: 1
  readonly checkedAt: number
  readonly detected: boolean
  readonly url: string
  readonly credentialFile: string
  readonly username: string
  readonly stateFile: string
  readonly configFile: string
  readonly source: string
  readonly servicePid?: number
  readonly serviceVersion?: string
  readonly health: {
    readonly ok: boolean
    readonly httpStatus?: number
    readonly version?: string
    readonly pid?: number
    readonly detail?: string
  }
  readonly models: readonly {
    readonly providerID: string
    readonly modelID: string
    readonly name?: string
    readonly variants?: readonly string[]
  }[]
  readonly error?: string
}

export async function loadOpenCodeService(signal?: AbortSignal): Promise<OpenCodeServiceStatus> {
  const payload = await getJson<{ ok: boolean; value?: OpenCodeServiceStatus; error?: { message?: string } }>('/api/opencode/service', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'OpenCode service discovery unavailable')
  return payload.value
}

export interface WorkerConfig {
  readonly schema: 1
  readonly enabled: boolean
  readonly opencodeUrl: string
  readonly opencodeUsername: string
  readonly opencodePasswordFile: string
  readonly workspacePath: string
  readonly pollIntervalMs: number
  readonly leaseTtlMs: number
  readonly model?: WorkerModelConfig
}

export interface WorkerConfigResponse {
  readonly config: WorkerConfig
  readonly path: string
  readonly restartRequired: boolean
  readonly detectedOpenCode?: OpenCodeServiceStatus
}

export async function loadWorkerConfig(signal?: AbortSignal): Promise<WorkerConfigResponse> {
  const payload = await getJson<{ ok: boolean; value?: WorkerConfigResponse; error?: { message?: string } }>('/api/worker/config', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'worker config unavailable')
  return payload.value
}

export async function saveWorkerConfig(config: WorkerConfig): Promise<WorkerConfigResponse> {
  const response = await fetch(`${apiBase()}/api/worker/config`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify(config),
  })
  const payload = await response.json() as { ok: boolean; value?: WorkerConfigResponse; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `worker config save failed: HTTP ${response.status}`)
  }
  return payload.value
}

export interface DiscoveredAgentService {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly running: boolean
  readonly pid: number | null
  readonly ppid: number | null
  readonly command: string | null
  readonly cwd?: string
  readonly ports: readonly number[]
  readonly warnings: readonly string[]
  readonly containerizable: boolean
}

export interface AgentCredentialSuggestion {
  readonly agentKind: string
  readonly label: string
  readonly path: string
  readonly exists: boolean
}

export interface AgentDiscovery {
  readonly scannedAt: number
  readonly platform: string
  readonly home: string
  readonly docker: { readonly checked: boolean; readonly available: boolean }
  readonly services: readonly DiscoveredAgentService[]
  readonly credentialSuggestions: readonly AgentCredentialSuggestion[]
  readonly safety: {
    readonly readsProcessMetadataOnly: boolean
    readonly readsFileContents: boolean
    readonly killsProcesses: boolean
    readonly executesSudo: boolean
  }
}

export interface MigrationAgentInput {
  readonly id: string
  readonly sourceWorkspacePath: string
  readonly sourceWorkspaceAuthorizationId?: string
  readonly workspaceMode: 'new' | 'reuse'
  readonly newWorkspacePath?: string
  readonly legacyReadOnly: boolean
  readonly credentialPaths: readonly string[]
}

export interface MigrationRequest {
  readonly agents: readonly MigrationAgentInput[]
  readonly image: string
  readonly command: readonly string[]
  readonly networkMode: 'none' | 'egress'
  readonly resources: { readonly cpus: number; readonly memoryMb: number; readonly pids: number }
}

export interface MigrationPlanMessage {
  readonly code: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly message: string
  readonly agentId?: string
}

export interface MigrationPlanAgent {
  readonly candidateId: string
  readonly kind: string
  readonly name: string
  readonly running: boolean
  readonly pid: number | null
  readonly sourceWorkspacePath: string
  readonly workspaceAuthorizationId?: string | null
  readonly workspaceMode: 'new' | 'reuse'
  readonly newWorkspacePath?: string
  readonly legacyReadOnly: boolean
  readonly credentialMounts: readonly { readonly source: string; readonly containerPath: string; readonly readOnly: true }[]
  readonly sandboxName: string
  readonly mounts: readonly unknown[]
}

export interface AgentMigrationPlan {
  readonly schema: 1
  readonly id: string
  readonly createdAt: number
  readonly agents: readonly MigrationPlanAgent[]
  readonly image: string
  readonly command: readonly string[]
  readonly networkMode: 'none' | 'egress'
  readonly resources: { readonly cpus: number; readonly memoryMb: number; readonly pids: number }
  readonly warnings: readonly MigrationPlanMessage[]
  readonly errors: readonly MigrationPlanMessage[]
  readonly blocked: boolean
  readonly steps: readonly string[]
}

export interface AgentDiscoveryPlanResult {
  readonly discovery: AgentDiscovery
  readonly plan: AgentMigrationPlan
}

export interface AgentMigrationRecord {
  readonly schema: 1
  readonly id: string
  readonly createdAt: number
  readonly finishedAt: number
  readonly status: 'succeeded' | 'failed' | string
  readonly image: string
  readonly agents: readonly {
    readonly candidateId: string
    readonly kind: string
    readonly name: string
    readonly sandboxName: string
    readonly sandboxStatus: string
    readonly workspaceMode: 'new' | 'reuse'
    readonly newWorkspacePath?: string
    readonly sourceWorkspacePath: string
    readonly workspaceAuthorizationId?: string | null
    readonly legacyReadOnly: boolean
    readonly credentialMounts: readonly { readonly source: string; readonly containerPath: string; readonly readOnly: true }[]
  }[]
}

export async function loadAgentDiscovery(signal?: AbortSignal): Promise<AgentDiscovery> {
  const payload = await getJson<{ ok: boolean; value?: AgentDiscovery; error?: { message?: string } }>('/api/agents/discover', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'agent discovery unavailable')
  return payload.value
}

export async function planAgentMigration(request: MigrationRequest): Promise<AgentDiscoveryPlanResult> {
  const response = await fetch(`${apiBase()}/api/agents/migrations/plan`, {
    method: 'POST',
    headers: localActionHeaders(),
    body: JSON.stringify(request),
  })
  const payload = await response.json() as { ok: boolean; value?: AgentDiscoveryPlanResult; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value === undefined) {
    throw new Error(payload.error?.message ?? `migration plan failed: HTTP ${response.status}`)
  }
  return payload.value
}

export async function applyAgentMigration(request: MigrationRequest): Promise<JobSummary> {
  return await startJob('agent-migrate', { request })
}

export async function loadAgentMigrations(signal?: AbortSignal): Promise<readonly AgentMigrationRecord[]> {
  const payload = await getJson<{ ok: boolean; value?: readonly AgentMigrationRecord[]; error?: { message?: string } }>('/api/agents/migrations', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'migration records unavailable')
  return payload.value
}
