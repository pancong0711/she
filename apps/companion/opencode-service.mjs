/** Read-only discovery of the local OpenCode service. Never returns secrets. */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function opencodeServicePaths(env = process.env, home = homedir()) {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, '.config')
  const stateHome = env.XDG_STATE_HOME?.trim() || join(home, '.local', 'state')
  return {
    stateFile: join(stateHome, 'opencode', 'service.json'),
    configFile: join(configHome, 'opencode', 'service.json'),
    legacyUrl: 'http://127.0.0.1:49375',
  }
}

function validLoopbackHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())) return undefined
    if (url.username !== '' || url.password !== '') return undefined
    return url.toString().replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

function basicAuth(password) {
  return `Basic ${Buffer.from(`opencode:${password}`, 'utf8').toString('base64')}`
}

export async function inspectOpenCodeService(options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const paths = opencodeServicePaths(env, home)
  const [state, config] = await Promise.all([readJson(paths.stateFile), readJson(paths.configFile)])
  const password = typeof state?.password === 'string' && state.password !== ''
    ? state.password
    : typeof config?.password === 'string' && config.password !== ''
      ? config.password
      : undefined
  const url = validLoopbackHttpUrl(state?.url) ?? (password === undefined ? undefined : paths.legacyUrl)
  const credentialFile = password === undefined
    ? undefined
    : typeof state?.password === 'string' && state.password !== ''
      ? paths.stateFile
      : paths.configFile
  const detected = url !== undefined && credentialFile !== undefined
  let health = { ok: false, detail: detected ? 'not probed' : 'OpenCode service.json not found or has no password' }
  if (detected && options.probe !== false) {
    try {
      const response = await fetch(`${url}/api/info`, {
        headers: { authorization: basicAuth(password), accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
        redirect: 'error',
      })
      let body
      try { body = await response.json() } catch { body = undefined }
      health = response.ok
        ? {
            ok: true,
            httpStatus: response.status,
            ...(typeof body?.version === 'string' ? { version: body.version } : {}),
            ...(typeof body?.pid === 'number' ? { pid: body.pid } : {}),
          }
        : {
            ok: false,
            httpStatus: response.status,
            detail: response.status === 401
              ? 'OpenCode authentication failed; the saved password does not match the running service'
              : `OpenCode HTTP ${String(response.status)}`,
          }
    } catch (error) {
      health = { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }
  return {
    schema: 1,
    checkedAt: Date.now(),
    detected,
    url: url ?? paths.legacyUrl,
    credentialFile: credentialFile ?? paths.configFile,
    username: 'opencode',
    stateFile: paths.stateFile,
    configFile: paths.configFile,
    source: detected
      ? credentialFile === paths.stateFile ? 'opencode-state-service' : 'opencode-config-service'
      : 'not-found',
    ...(typeof state?.pid === 'number' ? { servicePid: state.pid } : {}),
    ...(typeof state?.version === 'string' ? { serviceVersion: state.version } : {}),
    health,
  }
}

/**
 * Follow the live OpenCode service for worker configs that still contain the
 * old hard-coded Settings defaults. Explicit custom URLs are never rewritten.
 */
export function reconcileOpenCodeWorkerConfig(config, detected, legacyConfigFile) {
  if (detected?.detected !== true) return config
  if (config?.opencodeUsername !== 'opencode') return config
  if (config?.opencodeUrl !== 'http://127.0.0.1:49375') return config
  if (String(config?.opencodePasswordFile ?? '') !== legacyConfigFile) return config
  return {
    ...config,
    opencodeUrl: detected.url,
    opencodePasswordFile: detected.credentialFile,
  }
}
