import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { SANDBOX_IMAGE_PRESETS, defaultSandboxPreferences, validateSandboxPreferences } from '../sandbox-preferences.mjs'

describe('sandbox image preferences', () => {
  it('provides a visible image catalog and validates defaults', () => {
    expect(SANDBOX_IMAGE_PRESETS.some(item => item.image === 'node:22-bookworm-slim')).toBe(true)
    const config = validateSandboxPreferences({
      defaultImage: 'ubuntu:24.04',
      networkMode: 'none',
      resources: { cpus: 2, memoryMb: 2048, pids: 512 },
    }, defaultSandboxPreferences())
    expect(config).toMatchObject({ defaultImage: 'ubuntu:24.04', networkMode: 'none', resources: { cpus: 2, memoryMb: 2048 } })
    expect(() => validateSandboxPreferences({ defaultImage: 'bad image with spaces' })).toThrow(/invalid/)
  })
})
