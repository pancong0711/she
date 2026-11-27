/** Sandbox image presets and user-level default preferences. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export const SANDBOX_IMAGE_SOURCES = [
  {
    id: 'official',
    label: 'Docker Hub 官方源',
    registryPrefix: null,
    description: '直接使用 docker.io；需要能访问 registry-1.docker.io。',
  },
  {
    id: 'daocloud',
    label: 'DaoCloud 镜像代理（docker.m.daocloud.io）',
    registryPrefix: 'docker.m.daocloud.io',
    description: '第三方 Docker Hub 镜像代理。node:24-bookworm 会解析为 docker.m.daocloud.io/library/node:24-bookworm。',
  },
  {
    id: '1ms',
    label: '1ms.run 镜像代理（docker.1ms.run）',
    registryPrefix: 'docker.1ms.run',
    description: '第三方 Docker Hub 镜像代理。镜像内容与可用性由该服务提供方负责。',
  },
  {
    id: '1panel',
    label: '1Panel 镜像代理（docker.1panel.live）',
    registryPrefix: 'docker.1panel.live',
    description: '第三方 Docker Hub 镜像代理。镜像内容与可用性由该服务提供方负责。',
  },
]

export const SANDBOX_IMAGE_PRESETS = [
  {
    id: 'node24-full',
    label: 'Node 24 full（推荐 agent 基础镜像）',
    image: 'node:24-bookworm',
    description: '包含 Node/npm、bash、git、curl 和常见构建工具；适合作为预构建 agent 镜像的基础。镜像不是 agent 本身。',
    recommendedForAgents: true,
  },
  {
    id: 'node22-full',
    label: 'Node 22 full（兼容性优先）',
    image: 'node:22-bookworm',
    description: '与 Node 24 full 类似，适合依赖较旧 Node ABI 的 agent；仍建议锁定镜像 digest。',
    recommendedForAgents: true,
  },
  { id: 'node24', label: 'Node 24 slim', image: 'node:24-bookworm-slim', description: '有 bash/coreutils/apt 和 Node/npm，但缺少 git、curl 等常见工具；agent 需要额外安装。' },
  { id: 'node22', label: 'Node 22 slim', image: 'node:22-bookworm-slim', description: '体积较小的 Node 基础镜像；需要先确认 agent 的 shell、git、curl 和原生依赖。' },
  { id: 'ubuntu2404', label: 'Ubuntu 24.04', image: 'ubuntu:24.04', description: '通用 Linux 环境，bash/apt 完整；不预装 Node，Node agent 需要自定义 Dockerfile 安装 Node。' },
  { id: 'debian12', label: 'Debian 12 slim', image: 'debian:bookworm-slim', description: '轻量通用 Debian 环境；保留 bash/apt，但没有 Node。' },
  { id: 'alpine320', label: 'Alpine 3.20（谨慎）', image: 'alpine:3.20', description: '使用 sh/busybox，默认没有 bash/glibc；只适合明确兼容 musl 的 recipe。' },
  { id: 'python312', label: 'Python 3.12 slim', image: 'python:3.12-slim', description: 'Python agent/tool 基础镜像；不含 Node。' },
]

export function defaultSandboxPreferences() {
  return {
    schema: 1,
    defaultImage: 'node:24-bookworm',
    imageSource: 'official',
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

/**
 * Resolve a Docker Hub image reference through a selected mirror source.
 * Full references to another registry (for example ghcr.io/...) are left
 * untouched because a Docker Hub mirror cannot serve them.
 */
export function resolveSandboxImage(image, imageSource = 'official') {
  const text = validateSandboxImage(image)
  const source = SANDBOX_IMAGE_SOURCES.find(item => item.id === imageSource)
  const prefix = source?.registryPrefix
  if (prefix === null || prefix === undefined || prefix === '') return text

  const dockerHubReference = text.replace(/^(?:docker\.io|index\.docker\.io)\//, '')
  const stripped = dockerHubReference !== text
  const [first = '', ...rest] = dockerHubReference.split('/')
  const firstLooksLikeRegistry = rest.length > 0 && (first.includes('.') || first.includes(':') || first === 'localhost')
  if (!stripped && firstLooksLikeRegistry) return text
  const repository = rest.length === 0 ? `library/${first}` : [first, ...rest].join('/')
  return `${prefix.replace(/\/+$/, '')}/${repository}`
}

export function validateSandboxImageSource(imageSource, fallback = 'official') {
  return SANDBOX_IMAGE_SOURCES.some(item => item.id === imageSource) ? imageSource : fallback
}

export function validateSandboxPreferences(input, current = defaultSandboxPreferences()) {
  const image = validateSandboxImage(input?.defaultImage ?? current.defaultImage)
  const imageSource = validateSandboxImageSource(input?.imageSource, current.imageSource)
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
    imageSource,
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
