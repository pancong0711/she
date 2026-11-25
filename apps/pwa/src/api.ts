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
