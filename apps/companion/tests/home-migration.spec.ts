import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free migration helper
import { migrateSheHome, planSheHomeMigration } from '../home-migration.mjs'

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('SHE_HOME migration', () => {
  it('copies legacy app/config/state without deleting the sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'she-home-migrate-'))
    cleanup.push(root)
    const home = join(root, 'home')
    const legacyApp = join(home, '.local', 'share', 'she', 'companion')
    const legacyConfig = join(home, '.config', 'she')
    const legacyState = join(home, '.local', 'state', 'she')
    await mkdir(legacyApp, { recursive: true })
    await mkdir(legacyConfig, { recursive: true })
    await mkdir(legacyState, { recursive: true })
    await writeFile(join(legacyApp, 'launcher.mjs'), '// launcher\n')
    await writeFile(join(legacyConfig, 'token'), 'secret\n')
    await writeFile(join(legacyState, 'she.db'), 'db\n')

    const env = { HOME: home }
    const plan = await planSheHomeMigration(env, { platform: 'linux' })
    expect(plan.find(item => item.name === 'app')?.needed).toBe(true)
    const report = await migrateSheHome(env, { platform: 'linux' })
    expect(report.copied.map(item => item.name)).toEqual(['app', 'config', 'state'])
    expect(await readFile(join(home, '.local', 'share', 'she', 'app', 'launcher.mjs'), 'utf8')).toBe('// launcher\n')
    expect(await readFile(join(home, '.local', 'share', 'she', 'config', 'token'), 'utf8')).toBe('secret\n')
    expect(await readFile(join(legacyConfig, 'token'), 'utf8')).toBe('secret\n')
  })
})
