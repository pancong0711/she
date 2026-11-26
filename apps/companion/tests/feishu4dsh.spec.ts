import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import {
  defaultFeishu4dshPaths,
  inspectFeishu4dsh,
  validateFeishu4dshPackageSpec,
  validateFeishu4dshProfile,
} from '../feishu4dsh.mjs'

describe('feishu4dsh setup inspection', () => {
  it('finds a user-level dsh plugin profile without exposing secret values', async () => {
    const home = await mkdtemp(join(tmpdir(), 'she-feishu4dsh-'))
    const paths = defaultFeishu4dshPaths({}, home)
    await mkdir(paths.profileDir, { recursive: true })
    await mkdir(join(home, '.config', 'feishu4dsh'), { recursive: true })
    await writeFile(paths.profilePackageFile, JSON.stringify({
      name: 'dsh-profile-feishu4dsh',
      dependencies: { feishu4dsh: '0.23.1' },
    }))
    await writeFile(paths.envFile, 'FEISHU_APP_ID=cli_test\nFEISHU_APP_SECRET=super-secret\n', { mode: 0o600 })

    const result = await inspectFeishu4dsh({
      home,
      env: {},
      runCommand: async (command: string, args: readonly string[]) => {
        if (command === 'dsh') return { ok: true, code: 0, stdout: '0.2.1-rc.2', stderr: '' }
        if (command === 'systemctl' && args.includes('is-enabled')) return { ok: true, code: 0, stdout: 'enabled', stderr: '' }
        if (command === 'systemctl' && args.includes('is-active')) return { ok: true, code: 0, stdout: 'active', stderr: '' }
        return { ok: false, code: 1, stdout: '', stderr: 'unexpected command' }
      },
    })

    expect(result.dsh.available).toBe(true)
    expect(result.profile.pluginInstalled).toBe(true)
    expect(result.envFile.appIdConfigured).toBe(true)
    expect(result.envFile.appSecretConfigured).toBe(true)
    expect(result.envFile.permissionsOk).toBe(true)
    expect(result.service.active).toBe(true)
    expect(result.prerequisitesReady).toBe(true)
    expect(JSON.stringify(result)).not.toContain('super-secret')
  })

  it('validates profile names and package specs before invoking pnpm', () => {
    expect(validateFeishu4dshProfile('feishu4dsh')).toBe('feishu4dsh')
    expect(() => validateFeishu4dshProfile('../bad')).toThrow(/invalid/)
    expect(validateFeishu4dshPackageSpec('feishu4dsh')).toBe('feishu4dsh')
    expect(validateFeishu4dshPackageSpec('git+https://github.com/pancong0711/feishu4dsh.git')).toContain('github.com')
    expect(() => validateFeishu4dshPackageSpec('--evil')).toThrow()
    expect(() => validateFeishu4dshPackageSpec('package name with spaces')).toThrow()
  })
})
