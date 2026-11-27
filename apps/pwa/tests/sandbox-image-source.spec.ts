import { describe, expect, it } from 'vitest'
import { resolveSandboxImage } from '../src/api'

describe('sandbox image source resolution', () => {
  it('keeps the official image reference unchanged', () => {
    expect(resolveSandboxImage('node:24-bookworm', { id: 'official', label: 'Docker Hub', registryPrefix: null, description: '' }))
      .toBe('node:24-bookworm')
  })

  it('prefixes Docker Hub images with the selected mirror', () => {
    const source = { id: 'daocloud', label: 'DaoCloud', registryPrefix: 'docker.m.daocloud.io', description: '' }
    expect(resolveSandboxImage('node:24-bookworm', source)).toBe('docker.m.daocloud.io/library/node:24-bookworm')
    expect(resolveSandboxImage('some-user/agent:1.0', source)).toBe('docker.m.daocloud.io/some-user/agent:1.0')
    expect(resolveSandboxImage('docker.io/library/node:24-bookworm', source)).toBe('docker.m.daocloud.io/library/node:24-bookworm')
  })

  it('does not rewrite images from another registry', () => {
    const source = { id: 'daocloud', label: 'DaoCloud', registryPrefix: 'docker.m.daocloud.io', description: '' }
    expect(resolveSandboxImage('ghcr.io/example/agent:1.0', source)).toBe('ghcr.io/example/agent:1.0')
    expect(resolveSandboxImage('localhost:5000/agent:dev', source)).toBe('localhost:5000/agent:dev')
  })
})
