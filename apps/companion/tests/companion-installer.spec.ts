import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { installCompanionBundle, sha256File, writeCompanionCommand } from '../companion-installer.mjs'

const execFileAsync = promisify(execFile)
const cleanup: Array<() => Promise<void>> = []

async function makeArchive(root: string, version: string): Promise<string> {
  const bundle = join(root, `she-companion-${version}`)
  await mkdir(join(bundle, 'apps', 'companion'), { recursive: true })
  await writeFile(join(bundle, 'VERSION'), `${version}\n`)
  await writeFile(join(bundle, 'apps', 'companion', 'server.mjs'), 'console.log("test")\n')
  const archive = join(root, `she-companion-${version}.tar.gz`)
  await execFileAsync('tar', ['-czf', archive, '-C', root, `she-companion-${version}`])
  return archive
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

describe('companion installer', () => {
  it('installs a checksum-verified version and switches current', async () => {
    const root = await mkdtemp(join(tmpdir(), 'she-companion-installer-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const installRoot = join(root, 'install')
    const binDir = join(root, 'bin')
    const first = await makeArchive(root, '1.2.3')
    const firstSha = await sha256File(first)
    const firstResult = await installCompanionBundle({
      archivePath: first,
      expectedVersion: '1.2.3',
      expectedSha256: firstSha,
      installRoot,
      binDir,
      platform: 'linux',
    })
    expect(firstResult.previousTarget).toBeUndefined()
    expect((await readlink(join(installRoot, 'current')))).toBe('versions/1.2.3')
    expect(await readFile(join(installRoot, 'current', 'VERSION'), 'utf8')).toBe('1.2.3\n')

    const second = await makeArchive(root, '1.2.4')
    const secondResult = await installCompanionBundle({
      archivePath: second,
      expectedVersion: '1.2.4',
      expectedSha256: await sha256File(second),
      installRoot,
      binDir,
      platform: 'linux',
    })
    expect(secondResult.previousTarget).toBe('versions/1.2.3')
    expect(await readlink(join(installRoot, 'current'))).toBe('versions/1.2.4')
  })

  it('rejects a checksum mismatch without touching current', async () => {
    const root = await mkdtemp(join(tmpdir(), 'she-companion-installer-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const archive = await makeArchive(root, '1.2.3')
    await expect(installCompanionBundle({
      archivePath: archive,
      expectedVersion: '1.2.3',
      expectedSha256: '0'.repeat(64),
      installRoot: join(root, 'install'),
      binDir: join(root, 'bin'),
      platform: 'linux',
    })).rejects.toThrow(/SHA-256 mismatch/)
    await expect(readlink(join(root, 'install', 'current'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes a stable launcher command only after the launcher exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'she-companion-installer-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const installRoot = join(root, 'install')
    const binDir = join(root, 'bin')
    await mkdir(installRoot, { recursive: true })
    expect(await writeCompanionCommand({ installRoot, binDir, platform: 'linux' })).toBeUndefined()
    await writeFile(join(installRoot, 'launcher.mjs'), '// launcher\n')
    const command = await writeCompanionCommand({ installRoot, binDir, platform: 'linux' })
    expect(command).toBe(join(binDir, 'she-companion'))
    expect(await readFile(command!, 'utf8')).toContain('launcher.mjs')
  })
})
