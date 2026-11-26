/** Gateway adapter configuration and health probing. Never stores adapter secrets. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export function defaultGatewayConfig() {
  return {
    schema: 1,
    channel: 'feishu4dsh',
    enabled: false,
    adapterHealthUrl: '',
    secretBoundary: 'external-only',
  }
}

export function validateGatewayHealthUrl(value) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  let url
  try { url = new URL(text) } catch { throw new Error('gateway adapter health URL is invalid') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('gateway adapter health URL must be http(s)')
  const host = url.hostname.toLowerCase()
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('gateway adapter health URL must use a loopback host')
  }
  if (url.username !== '' || url.password !== '') throw new Error('gateway adapter health URL must not contain credentials')
  return url.toString()
}

export function validateGatewayConfig(input, current = defaultGatewayConfig()) {
  const enabled = input?.enabled === true
  const adapterHealthUrl = validateGatewayHealthUrl(input?.adapterHealthUrl ?? current.adapterHealthUrl)
  if (enabled && adapterHealthUrl === '') throw new Error('enabled gateway requires an adapter health URL')
  return {
    schema: 1,
    channel: 'feishu4dsh',
    enabled,
    adapterHealthUrl,
    secretBoundary: 'external-only',
  }
}

export async function readGatewayConfig(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed?.schema !== 1) throw new Error('invalid gateway config schema')
    return validateGatewayConfig(parsed, defaultGatewayConfig())
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultGatewayConfig()
    throw error
  }
}

export async function writeGatewayConfig(path, config) {
  const validated = validateGatewayConfig(config)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
  return validated
}

export async function probeGatewayAdapter(url) {
  if (url === '') return { configured: false, reachable: false, detail: 'adapter health URL not configured' }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3_000),
      redirect: 'error',
      headers: { accept: 'application/json' },
    })
    let body
    try { body = await response.json() } catch { body = undefined }
    return {
      configured: true,
      reachable: response.ok,
      httpStatus: response.status,
      ...(body === undefined ? {} : { response: body }),
    }
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
