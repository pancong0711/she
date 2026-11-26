/** Sandbox image presets and user-level default preferences. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export const SANDBOX_IMAGE_PRESETS = [
  { id: 'node22', label: 'Node 22 slim', image: 'node:22-bookworm-slim', description: '通用 Node/agent 基础镜像，体积适中。' },
  { id: 'node24', label: 'Node 24 slim', image: 'node:24-bookworm-slim', description: '较新的 Node.js 运行时。' },
  { id: 'ubuntu2404', label: 'Ubuntu 24.04', image: 'ubuntu:24.04', description: '通用 Ubuntu 环境，需自行安装 agent/runtime。' },
  { id: 'debian12', label: 'Debian 12 slim', image: 'debian:bookworm-slim', description: '轻量通用 Debian 环境。' },
  { id: 'alpine320', label: 'Alpine 3.20', image: 'alpine:3.20', description: '最小镜像，适合 utility 或网络工具。' },
  { id: 'python312', label: 'Python 3.12 slim', image: 'python:3.12-slim', description: 'Python agent/tool 基础镜像。' },
]

export function defaultSandboxPreferences() {
  return {
    schema: 1,
    defaultImage: 'node:22-bookworm-slim',
    networkMode: 'egress',
    resources: { cpus: 1, memoryMb: 1024, pids: 256 },
  }
}

export function validateSandboxImage(image) {
  const text = String(image ?? '').trim()
  if (text === '') throw new Error('sandbox image must not be empty')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,299}$/.test(text)) throw new Error('sandbox image name is invalid')
  return text
}

export function validateSandboxPreferences(input, current = defaultSandboxPreferences()) {
  const image = validateSandboxImage(input?.defaultImage ?? current.defaultImage)
  const networkMode = input?.networkMode === 'none' ? 'none' : input?.networkMode === 'egress' ? 'egress' : current.networkMode
  const cpus = input?.resources?.cpus === undefined ? current.resources.cpus : Number(input.resources.cpus)
  const memoryMb = input?.resources?.memoryMb === undefined ? current.resources.memoryMb : Number(input.resources.memoryMb)
  const pids = input?.resources?.pids === undefined ? current.resources.pids : Number(input.resources.pids)
  if (!Number.isFinite(cpus) || cpus <= 0 || cpus > 64) throw new Error('cpus must be between 0 and 64')
  if (!Number.isInteger(memoryMb) || memoryMb < 128 || memoryMb > 131_072) throw new Error('memoryMb must be between 128 and 131072')
  if (!Number.isInteger(pids) || pids < 16 || pids > 16_384) throw new Error('pids must be between 16 and 16384')
  return {
    schema: 1,
    defaultImage: image,
    networkMode,
    resources: { cpus, memoryMb, pids },
  }
}

export async function readSandboxPreferences(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed?.schema !== 1) throw new Error('invalid sandbox preferences schema')
    return validateSandboxPreferences(parsed, defaultSandboxPreferences())
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultSandboxPreferences()
    throw error
  }
}

export async function writeSandboxPreferences(path, input) {
  const current = await readSandboxPreferences(path)
  const config = validateSandboxPreferences(input, current)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
  return config
}
