/** Registry-backed agent version resolution and successful-install history. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SANDBOX_AGENT_RECIPES, sandboxAgentRecipeWithVersion } from './sandbox-agent-recipes.mjs'

const REGISTRIES = [
  'https://registry.npmmirror.com',
  'https://registry.npmjs.org',
]
const CACHE_TTL_MS = 5 * 60_000
const metadataCache = new Map()

function packagePath(packageName) {
  return packageName.startsWith('@')
    ? `/${packageName.replace('/', '%2F')}`
    : `/${encodeURIComponent(packageName)}`
}

export async function fetchPackageMetadata(packageName, options = {}) {
  const cached = metadataCache.get(packageName)
  if (options.refresh !== true && cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) return cached.value
  const fetchImpl = options.fetchImpl ?? fetch
  let lastError
  for (const registry of REGISTRIES) {
    try {
      const response = await fetchImpl(`${registry}${packagePath(packageName)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (body === null || typeof body !== 'object' || body.versions === null || typeof body.versions !== 'object') {
        throw new Error('registry metadata has no versions')
      }
      const versions = Object.keys(body.versions)
      const latest = typeof body['dist-tags']?.latest === 'string' ? body['dist-tags'].latest : versions.at(-1)
      const value = { registry, versions, latest }
      metadataCache.set(packageName, { at: Date.now(), value })
      return value
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`cannot query ${packageName} version metadata: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function compareVersionsDesc(left, right) {
  const a = left.split(/[.+-]/).slice(0, 3).map(Number)
  const b = right.split(/[.+-]/).slice(0, 3).map(Number)
  for (let index = 0; index < 3; index += 1) {
    const diff = (b[index] ?? 0) - (a[index] ?? 0)
    if (diff !== 0) return diff
  }
  return right.localeCompare(left)
}

export async function resolveSandboxAgentVersion(agentId, requestedVersion = '', options = {}) {
  const recipe = SANDBOX_AGENT_RECIPES.find(item => item.id === agentId)
  if (recipe === undefined) throw new Error(`unknown sandbox agent: ${agentId}`)
  const requested = String(requestedVersion ?? '').trim() || recipe.version
  let metadata
  try {
    metadata = await fetchPackageMetadata(recipe.packageName, options)
  } catch (error) {
    return {
      schema: 1,
      agentId,
      packageName: recipe.packageName,
      requested,
      resolved: recipe.version,
      exact: requested === recipe.version,
      fallback: requested !== recipe.version,
      verified: false,
      registry: null,
      latest: recipe.version,
      availableVersions: [recipe.version],
      warning: error instanceof Error ? error.message : String(error),
      recipe: sandboxAgentRecipeWithVersion(agentId, recipe.version),
    }
  }
  const exact = metadata.versions.includes(requested)
  const resolved = exact ? requested : metadata.latest
  const availableVersions = [...metadata.versions]
    .filter(version => !version.includes('-'))
    .sort(compareVersionsDesc)
    .slice(0, 30)
  return {
    schema: 1,
    agentId,
    packageName: recipe.packageName,
    requested,
    resolved,
    exact,
    fallback: !exact,
    verified: true,
    registry: metadata.registry,
    latest: metadata.latest,
    availableVersions,
    ...(exact ? {} : { warning: `${recipe.packageName}@${requested} 不存在；已使用最新稳定版 ${resolved}` }),
    recipe: sandboxAgentRecipeWithVersion(agentId, resolved),
  }
}

export function emptyAgentVersionRegistry() {
  return { schema: 1, agents: {} }
}

export async function readAgentVersionRegistry(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed?.schema !== 1 || typeof parsed.agents !== 'object' || parsed.agents === null) {
      throw new Error('invalid agent version registry schema')
    }
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyAgentVersionRegistry()
    throw error
  }
}

export async function recordAgentInstall(path, input, now = Date.now()) {
  const agentId = String(input?.agentId ?? '').trim()
  const version = String(input?.version ?? '').trim()
  if (SANDBOX_AGENT_RECIPES.every(item => item.id !== agentId)) throw new Error(`unknown sandbox agent: ${agentId}`)
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,79}$/.test(version)) throw new Error('agent version is invalid')
  if (input?.success !== true) throw new Error('only successful agent installs are recorded')
  const current = await readAgentVersionRegistry(path)
  const previous = Array.isArray(current.agents[agentId]?.versions) ? current.agents[agentId].versions : []
  const entry = {
    version,
    installedAt: now,
    ...(typeof input.sandboxName === 'string' && input.sandboxName.trim() !== '' ? { sandboxName: input.sandboxName.trim() } : {}),
  }
  const versions = [entry, ...previous.filter(item => item.version !== version)]
    .sort((left, right) => Number(right.installedAt ?? 0) - Number(left.installedAt ?? 0))
    .slice(0, 5)
  const next = {
    schema: 1,
    agents: {
      ...current.agents,
      [agentId]: { versions },
    },
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
  return next
}

export function installedVersionsFor(registry, agentId) {
  return Array.isArray(registry?.agents?.[agentId]?.versions) ? registry.agents[agentId].versions : []
}
