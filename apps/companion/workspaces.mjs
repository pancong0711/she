/** Workspace authorization registry and leaf-directory validation. */

import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'

const FORBIDDEN_SYSTEM_PATHS = [
  '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/dev',
  '/proc', '/sys', '/run', '/var/run', '/var/lib/docker',
]

const BROAD_CONTAINER_PATHS = ['/home', '/Users', '/mnt', '/media', '/Volumes', '/tmp']

function samePath(left, right) {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right)
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function forbiddenWorkspacePath(realPath, home) {
  if (samePath(realPath, parse(realPath).root)) return '文件系统根目录不能授权为 workspace'
  if (samePath(realPath, home)) return '用户主目录本身不能授权为 workspace'
  if (process.platform !== 'win32') {
    for (const broad of BROAD_CONTAINER_PATHS) {
      if (samePath(realPath, broad)) return `范围过大的容器目录不能直接授权：${broad}`
    }
    for (const forbidden of FORBIDDEN_SYSTEM_PATHS) {
      if (samePath(realPath, forbidden) || isWithin(forbidden, realPath)) {
        return `受保护的系统路径不能授权为 workspace：${forbidden}`
      }
    }
  }
  return undefined
}

function workspaceId(realPath) {
  return `ws-${createHash('sha256').update(realPath).digest('hex').slice(0, 12)}`
}

export async function validateWorkspacePath(input, homeDirectory = homedir()) {
  const requested = String(input ?? '').trim()
  if (requested === '') throw new Error('workspace path is required')
  if (!isAbsolute(requested)) throw new Error('workspace path must be absolute')
  const home = await realpath(homeDirectory).catch(() => resolve(homeDirectory))
  const realPath = await realpath(requested).catch(() => undefined)
  if (realPath === undefined) throw new Error(`workspace path does not exist: ${requested}`)
  const info = await stat(realPath).catch(() => undefined)
  if (info === undefined || !info.isDirectory()) throw new Error('workspace path must be a directory')
  const forbidden = forbiddenWorkspacePath(realPath, home)
  if (forbidden !== undefined) throw new Error(forbidden)
  const [readable, writable] = await Promise.all([
    access(realPath, fsConstants.R_OK).then(() => true).catch(() => false),
    access(realPath, fsConstants.W_OK).then(() => true).catch(() => false),
  ])
  return {
    requested: resolve(requested),
    realPath,
    readable,
    writable,
    leafAuthorized: true,
  }
}

export async function readWorkspaceRegistry(registryPath) {
  try {
    const parsed = JSON.parse(await readFile(registryPath, 'utf8'))
    if (parsed?.schema !== 1 || !Array.isArray(parsed.workspaces)) throw new Error('invalid workspace registry schema')
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return { schema: 1, updatedAt: Date.now(), workspaces: [] }
    throw error
  }
}

async function writeWorkspaceRegistry(registryPath, registry) {
  await mkdir(dirname(registryPath), { recursive: true, mode: 0o700 })
  const temporary = `${registryPath}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, registryPath)
}

export async function listWorkspaceAuthorizations(registryPath, homeDirectory = homedir()) {
  const registry = await readWorkspaceRegistry(registryPath)
  return Promise.all(registry.workspaces.map(async record => {
    const warnings = []
    let exists = false
    let isDirectory = false
    let readable = false
    let writable = false
    let leafAuthorized = false
    let currentRealPath
    try {
      const info = await stat(record.path)
      exists = true
      isDirectory = info.isDirectory()
      currentRealPath = await realpath(record.path)
      ;[readable, writable] = await Promise.all([
        access(record.path, fsConstants.R_OK).then(() => true).catch(() => false),
        access(record.path, fsConstants.W_OK).then(() => true).catch(() => false),
      ])
      const home = await realpath(homeDirectory).catch(() => resolve(homeDirectory))
      leafAuthorized = forbiddenWorkspacePath(currentRealPath, home) === undefined
      if (currentRealPath !== record.realPath) warnings.push('workspace realpath 已变化，请删除后重新授权。')
      if (!isDirectory) warnings.push('授权路径已不是目录。')
      if (!writable) warnings.push('当前用户对该目录不可写；只读挂载仍可用。')
    } catch {
      warnings.push('授权目录不存在或不可访问。')
    }
    return {
      ...record,
      exists,
      isDirectory,
      readable,
      writable,
      leafAuthorized,
      warnings,
    }
  }))
}

export async function authorizeWorkspace(registryPath, input, homeDirectory = homedir()) {
  const label = String(input?.label ?? '').trim() || 'workspace'
  if (label.length > 100) throw new Error('workspace label is too long')
  const mode = input?.mode === 'read-only' ? 'read-only' : input?.mode === 'read-write' ? 'read-write' : undefined
  if (mode === undefined) throw new Error('workspace mode must be read-only or read-write')
  const validated = await validateWorkspacePath(input?.path, homeDirectory)
  if (mode === 'read-write' && !validated.writable) throw new Error('read-write authorization requires a writable directory')
  const registry = await readWorkspaceRegistry(registryPath)
  const now = Date.now()
  const record = {
    id: workspaceId(validated.realPath),
    label,
    path: validated.requested,
    realPath: validated.realPath,
    mode,
    authorizedAt: now,
  }
  const existing = registry.workspaces.find(item => item.id === record.id)
  const workspaces = existing === undefined
    ? [...registry.workspaces, record]
    : registry.workspaces.map(item => item.id === record.id ? record : item)
  const next = { schema: 1, updatedAt: now, workspaces }
  await writeWorkspaceRegistry(registryPath, next)
  return record
}

export async function removeWorkspaceAuthorization(registryPath, id) {
  const registry = await readWorkspaceRegistry(registryPath)
  if (!/^ws-[a-f0-9]{12}$/.test(String(id ?? ''))) throw new Error('invalid workspace authorization id')
  const workspaces = registry.workspaces.filter(item => item.id !== id)
  if (workspaces.length === registry.workspaces.length) throw new Error('workspace authorization not found')
  await writeWorkspaceRegistry(registryPath, { schema: 1, updatedAt: Date.now(), workspaces })
}
