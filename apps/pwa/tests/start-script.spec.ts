import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const cleanup: string[] = []

async function mkdirGenerated(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('start.sh bootstrap', () => {
  it('uses an installed launcher immediately without touching the network', async () => {
    const root = await mkdtemp(join(tmpdir(), 'she-start-local-'))
    cleanup.push(root)
    const installRoot = join(root, 'install')
    await writeFile(join(root, 'marker'), '')
    await mkdirGenerated(installRoot)
    const launcher = "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.SHE_COMPANION_ROOT + '/launcher-run-local', 'ok')\n"
    await writeFile(join(installRoot, 'launcher.mjs'), launcher, { mode: 0o755 })

    const { stdout } = await execFileAsync('bash', ['apps/pwa/public/start.sh'], {
      cwd: process.cwd(),
      timeout: 30_000,
      env: {
        ...process.env,
        HOME: root,
        SHE_COMPANION_ROOT: installRoot,
        SHE_BIN_DIR: join(root, 'bin'),
        SHE_COMPANION_MANIFEST_URL: 'file:///definitely/not/present/manifest.json',
      },
    })
    expect(stdout).toContain('using installed launcher')
    expect(stdout).not.toContain('fetching launcher manifest')
    expect(await readFile(join(installRoot, 'launcher-run-local'), 'utf8')).toBe('ok')
  })

  it('falls back to the Pages launcher mirror when the release URL fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'she-start-script-'))
    cleanup.push(root)
    const installRoot = join(root, 'install')
    const binDir = join(root, 'bin')
    const launcherPath = join(root, 'she-launcher.mjs')
    const launcher = "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.SHE_COMPANION_ROOT + '/launcher-run', 'ok')\n"
    await writeFile(launcherPath, launcher, { mode: 0o755 })
    const sha256 = createHash('sha256').update(launcher).digest('hex')
    const manifestPath = join(root, 'companion-release-manifest.json')
    await writeFile(manifestPath, JSON.stringify({
      schema: 1,
      name: 'she-companion',
      version: '0.0.1',
      bundle: { file: 'she-companion-0.0.1.tar.gz', sha256: 'a'.repeat(64) },
      launcher: {
        file: 'she-launcher.mjs',
        url: `file://${join(root, 'missing', 'she-launcher.mjs')}`,
        sha256,
      },
    }))

    const { stdout } = await execFileAsync('bash', ['apps/pwa/public/start.sh'], {
      cwd: process.cwd(),
      timeout: 30_000,
      env: {
        ...process.env,
        HOME: root,
        SHE_COMPANION_ROOT: installRoot,
        SHE_BIN_DIR: binDir,
        SHE_COMPANION_MANIFEST_URL: `file://${manifestPath}`,
      },
    })
    expect(stdout).toContain('trying channel mirror')
    expect(await readFile(join(installRoot, 'launcher-run'), 'utf8')).toBe('ok')
  })
})
