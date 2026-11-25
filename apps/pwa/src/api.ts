import type { GatewayHealth, GatewaySnapshot } from '@she/protocol'

export interface SnapshotResult {
  readonly health: GatewayHealth
  readonly snapshot: GatewaySnapshot
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return await response.json() as T
}

async function getResult<T>(path: string): Promise<T> {
  const payload = await getJson<{ ok: boolean; value?: T; error?: { message?: string } }>(path)
  if (!payload.ok) throw new Error(payload.error?.message ?? 'SHE request failed')
  return payload.value as T
}

export async function loadSnapshot(): Promise<SnapshotResult> {
  const [health, snapshot] = await Promise.all([
    getJson<GatewayHealth>('/v1/health'),
    getResult<GatewaySnapshot>('/v1/snapshot'),
  ])
  return { health, snapshot }
}
