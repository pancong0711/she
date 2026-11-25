import type {
  GatewayHealth,
  GatewaySnapshot,
  SandboxBrokerHealth,
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
const DEFAULT_COMPANION = 'http://127.0.0.1:8787'

export function isLocalOrigin(): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
}

export function getCompanionUrl(): string {
  return localStorage.getItem(COMPANION_KEY)?.trim() || DEFAULT_COMPANION
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

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  })
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

export async function loadSandboxes(signal?: AbortSignal): Promise<SandboxResult> {
  const [health, sandboxes] = await Promise.all([
    getJson<SandboxBrokerHealth>(`${brokerBase()}/v1/health`, signal),
    getResult<readonly SandboxView[]>(`${brokerBase()}/v1/sandboxes`, signal),
  ])
  return { health, sandboxes }
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
  | { readonly at: number; readonly type: 'check'; readonly status: 'ok' | 'warn' | 'fail'; readonly label: string; readonly detail: string }
  | { readonly at: number; readonly type: 'status'; readonly status: JobSummary['status'] }
  | { readonly at: number; readonly type: 'done'; readonly status: JobSummary['status']; readonly exitCode: number }

export async function loadCompanionHealth(signal?: AbortSignal): Promise<CompanionHealth> {
  const payload = await getJson<{ ok: boolean; value?: CompanionHealth; error?: { message?: string } }>('/api/health', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'companion unavailable')
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

export interface CoreStatus {
  readonly companion: string
  readonly supervisor: {
    readonly state: 'running' | 'stopped'
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

export const DEFAULT_CORE_MANIFEST_URL = 'https://github.com/pancong0711/she/releases/download/v0.1.0-core.1/release-manifest.json'

export const COMPANION_RELEASE_TAG = 'v0.1.0-companion.1'
export const COMPANION_RELEASE_URL = `https://github.com/pancong0711/she/releases/tag/${COMPANION_RELEASE_TAG}`
export const COMPANION_MANIFEST_URL = `https://github.com/pancong0711/she/releases/download/${COMPANION_RELEASE_TAG}/companion-release-manifest.json`
export const COMPANION_BUNDLE_URL = `https://github.com/pancong0711/she/releases/download/${COMPANION_RELEASE_TAG}/she-companion-0.1.0.tar.gz`
export const COMPANION_INSTALLER_URL = `https://github.com/pancong0711/she/releases/download/${COMPANION_RELEASE_TAG}/install-companion.sh`

function localActionHeaders(): Record<string, string> {
  return { accept: 'application/json', 'content-type': 'application/json', 'x-she-local-action': '1' }
}

export async function loadCoreStatus(signal?: AbortSignal): Promise<CoreStatus> {
  const payload = await getJson<{ ok: boolean; value?: CoreStatus; error?: { message?: string } }>('/api/core/status', signal)
  if (!payload.ok || payload.value === undefined) throw new Error(payload.error?.message ?? 'core status unavailable')
  return payload.value
}

export async function coreAction(action: 'start' | 'stop' | 'restart'): Promise<CoreStatus> {
  const response = await fetch(`${apiBase()}/api/core/${action}`, {
    method: 'POST',
    headers: localActionHeaders(),
  })
  const payload = await response.json() as { ok: boolean; value?: { status?: CoreStatus }; error?: { message?: string } }
  if (!response.ok || !payload.ok || payload.value?.status === undefined) {
    throw new Error(payload.error?.message ?? `core action failed: HTTP ${response.status}`)
  }
  return payload.value.status
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
