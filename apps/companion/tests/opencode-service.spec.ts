import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { inspectOpenCodeService, reconcileOpenCodeWorkerConfig } from '../opencode-service.mjs'

describe('OpenCode service discovery', () => {
  it('uses the current state service URL and never exposes the password', async () => {
    const home = await mkdtemp(join(tmpdir(), 'she-opencode-'))
    const stateDir = join(home, '.local', 'state', 'opencode')
    await mkdir(stateDir, { recursive: true })
    await writeFile(join(stateDir, 'service.json'), JSON.stringify({
      id: 'svc-1',
      version: '2.3.2',
      url: 'http://127.0.0.1:49374',
      pid: 123,
      password: 'super-secret-password',
    }))

    const result = await inspectOpenCodeService({
      home,
      env: {},
      probe: false,
    })

    expect(result.detected).toBe(true)
    expect(result.url).toBe('http://127.0.0.1:49374')
    expect(result.credentialFile).toContain('/.local/state/opencode/service.json')
    expect(result.source).toBe('opencode-state-service')
    expect(JSON.stringify(result)).not.toContain('super-secret-password')
  })

  it('falls back to the legacy config password file when only that exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'she-opencode-legacy-'))
    const configDir = join(home, '.config', 'opencode')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'service.json'), JSON.stringify({ password: 'legacy-password' }))

    const result = await inspectOpenCodeService({ home, env: {}, probe: false })
    expect(result.detected).toBe(true)
    expect(result.url).toBe('http://127.0.0.1:49375')
    expect(result.credentialFile).toContain('/.config/opencode/service.json')
  })

  it('migrates only legacy hard-coded worker defaults to the live service', () => {
    const detected = {
      detected: true,
      url: 'http://127.0.0.1:49374',
      credentialFile: '/home/test/.local/state/opencode/service.json',
    }
    const legacy = {
      opencodeUsername: 'opencode',
      opencodeUrl: 'http://127.0.0.1:49375',
      opencodePasswordFile: '/home/test/.config/opencode/service.json',
    }
    expect(reconcileOpenCodeWorkerConfig(legacy, detected, legacy.opencodePasswordFile)).toMatchObject({
      opencodeUrl: 'http://127.0.0.1:49374',
      opencodePasswordFile: '/home/test/.local/state/opencode/service.json',
    })
    expect(reconcileOpenCodeWorkerConfig({ ...legacy, opencodeUrl: 'http://127.0.0.1:49999' }, detected, legacy.opencodePasswordFile).opencodeUrl)
      .toBe('http://127.0.0.1:49999')
  })
})
