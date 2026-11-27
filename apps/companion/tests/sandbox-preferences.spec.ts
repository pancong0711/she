import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { SANDBOX_IMAGE_PRESETS, SANDBOX_IMAGE_SOURCES, defaultSandboxPreferences, resolveSandboxImage, validateSandboxPreferences } from '../sandbox-preferences.mjs'

describe('sandbox image preferences', () => {
  it('provides a visible image catalog and validates defaults', () => {
    expect(SANDBOX_IMAGE_PRESETS.some(item => item.image === 'node:22-bookworm-slim')).toBe(true)
    const config = validateSandboxPreferences({
      defaultImage: 'ubuntu:24.04',
      networkMode: 'none',
      resources: { cpus: 2, memoryMb: 2048, pids: 512 },
    }, defaultSandboxPreferences())
    expect(config).toMatchObject({ defaultImage: 'ubuntu:24.04', imageSource: 'official', networkMode: 'none', resources: { cpus: 2, memoryMb: 2048 } })
    expect(() => validateSandboxPreferences({ defaultImage: 'bad image with spaces' })).toThrow(/invalid/)
  })

  it('offers Docker Hub official and mirror sources', () => {
    expect(SANDBOX_IMAGE_SOURCES[0]?.id).toBe('official')
    expect(SANDBOX_IMAGE_SOURCES.some(item => item.id === 'daocloud' && item.registryPrefix === 'docker.m.daocloud.io')).toBe(true)
    expect(resolveSandboxImage('node:24-bookworm', 'official')).toBe('node:24-bookworm')
    expect(resolveSandboxImage('node:24-bookworm', 'daocloud')).toBe('docker.m.daocloud.io/library/node:24-bookworm')
    expect(resolveSandboxImage('some-user/agent:1.0', '1ms')).toBe('docker.1ms.run/some-user/agent:1.0')
    expect(resolveSandboxImage('docker.io/library/node:24-bookworm', '1panel')).toBe('docker.1panel.live/library/node:24-bookworm')
  })

  it('does not rewrite images hosted on another registry', () => {
    expect(resolveSandboxImage('ghcr.io/example/agent:1.0', 'daocloud')).toBe('ghcr.io/example/agent:1.0')
    expect(resolveSandboxImage('localhost:5000/agent:dev', 'daocloud')).toBe('localhost:5000/agent:dev')
  })

  it('persists a valid image source and falls back for unknown ids', () => {
    const config = validateSandboxPreferences({ imageSource: 'daocloud' }, defaultSandboxPreferences())
    expect(config.imageSource).toBe('daocloud')
    expect(validateSandboxPreferences({ imageSource: 'unknown' }, defaultSandboxPreferences()).imageSource).toBe('official')
  })
})
