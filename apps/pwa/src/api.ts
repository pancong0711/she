import type { GatewayHealth, GatewaySnapshot } from '@she/protocol'

export interface SnapshotResult {
  readonly health: GatewayHealth
  readonly snapshot: GatewaySnapshot
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

export const INSTALL_COMMANDS = [
  'git clone https://github.com/pancong0711/she.git',
  'cd she',
  'pnpm install',
  'pnpm pwa:build',
  'pnpm pwa:serve',
]

export const REPO_URL = 'https://github.com/pancong0711/she'
