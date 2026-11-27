import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { legacyShePaths, resolveSheHome, resolveShePaths } from '../paths.mjs'

describe('SHE_HOME path resolution', () => {
  it('uses one canonical root on Linux and Windows', () => {
    expect(resolveSheHome({ HOME: '/home/user' }, { platform: 'linux' })).toBe('/home/user/.local/share/she')
    expect(resolveSheHome({ HOME: '/home/user', XDG_DATA_HOME: '/data' }, { platform: 'linux' })).toBe('/data/she')
    expect(resolveSheHome({ USERPROFILE: 'C:\\Users\\me', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, { platform: 'win32' }))
      .toBe('C:\\Users\\me\\AppData\\Local\\SHE')
    expect(resolveSheHome({ SHE_HOME: '/opt/she' }, { platform: 'linux' })).toBe('/opt/she')
  })

  it('uses the unified layout for a fresh install', () => {
    const paths = resolveShePaths({ HOME: '/home/user' }, { platform: 'linux', exists: () => false })
    expect(paths.home).toBe('/home/user/.local/share/she')
    expect(paths.appRoot).toBe('/home/user/.local/share/she/app')
    expect(paths.coreRoot).toBe('/home/user/.local/share/she/core')
    expect(paths.configRoot).toBe('/home/user/.local/share/she/config')
    expect(paths.stateRoot).toBe('/home/user/.local/share/she/state')
  })

  it('keeps existing legacy installations usable', () => {
    const legacy = legacyShePaths({ HOME: '/home/user' }, { platform: 'linux' })
    const existing = new Set([legacy.appRoot, legacy.configRoot, legacy.stateRoot])
    const paths = resolveShePaths({ HOME: '/home/user' }, { platform: 'linux', exists: path => existing.has(path) })
    expect(paths.appRoot).toBe(legacy.appRoot)
    expect(paths.configRoot).toBe(legacy.configRoot)
    expect(paths.stateRoot).toBe(legacy.stateRoot)
  })

  it('honors explicit path overrides', () => {
    const paths = resolveShePaths({
      HOME: '/home/user',
      SHE_COMPANION_ROOT: '/tmp/app',
      SHE_CORE_ROOT: '/tmp/core',
      SHE_CONFIG_HOME: '/tmp/config',
      SHE_STATE_HOME: '/tmp/state',
      SHE_RUNTIME_DIR: '/tmp/run',
      SHE_BIN_DIR: '/tmp/bin',
    }, { platform: 'linux', exists: () => false })
    expect(paths).toMatchObject({
      appRoot: '/tmp/app',
      coreRoot: '/tmp/core',
      configRoot: '/tmp/config',
      stateRoot: '/tmp/state',
      runtimeRoot: '/tmp/run',
      binDir: '/tmp/bin',
    })
  })
})
