import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { dockerGuidance, summarizePreflight } from '../preflight.mjs'

describe('preflight diagnostics', () => {
  it('turns docker ENOENT into an actionable sandbox capability message', () => {
    const guidance = dockerGuidance({ ok: false, stderr: 'command not found: docker' }, 'linux')
    expect(guidance.detail).toContain('docker 命令不存在')
    expect(guidance.detail).toContain('Sandbox')
    expect(guidance.remediation).toContain('rootless Docker')
    expect(guidance.remediation).toContain('不会代你安装')
  })

  it('distinguishes daemon and permission failures', () => {
    expect(dockerGuidance({ ok: false, stderr: 'permission denied while trying to connect' }, 'linux').detail)
      .toContain('没有访问 Docker daemon 的权限')
    expect(dockerGuidance({ ok: false, stderr: 'Cannot connect to the Docker daemon' }, 'linux').detail)
      .toContain('daemon 未运行')
  })

  it('keeps required readiness separate from sandbox readiness', () => {
    const outcome = summarizePreflight([
      { type: 'check', status: 'ok', label: 'Node.js', requirement: 'required' },
      {
        type: 'check',
        status: 'warn',
        label: 'Docker sandbox runtime',
        requirement: 'sandbox',
        feature: 'sandbox',
        detail: 'docker missing',
      },
    ], false)
    expect(outcome.ok).toBe(true)
    expect(outcome.sandboxReady).toBe(false)
    expect(outcome.summary).toEqual({ requiredReady: true, sandboxReady: false, persistenceReady: true, warnings: 1, failures: 0 })
  })
})
