/**
 * Cross-platform companion bundle installer.
 *
 * This module only installs immutable version directories and switches the
 * `current` pointer. It never kills a running companion and never executes a
 * host shell. The stable launcher/supervisor owns process restart and rollback.
 *
 * Keeping this in Node means the same update path works on Linux, macOS and
 * Windows without requiring `bash install-companion.sh`.
 */

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function isSafeCompanionVersion(value) {
  return /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(String(value ?? '').trim())
}

export async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

async function removePath(path) {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || info.isFile()) {
      await unlink(path)
      return
    }
    await rm(path, { recursive: true, force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function replaceCurrentPointer(installRoot, version, platform = process.platform) {
  const current = join(installRoot, 'current')
  const destination = join(installRoot, 'versions', version)
  const previousTarget = await readlink(current).catch(() => undefined)
  // On Windows a junction cannot be atomically replaced by symlink(); remove
  // the old pointer first. The version directory itself is already complete.
  if (platform === 'win32') {
    try {
      await execFileAsync('cmd', ['/c', 'rmdir', current])
    } catch {
      await removePath(current)
    }
    await symlink(destination, current, 'junction')
  } else {
    await removePath(current)
    await symlink(join('versions', version), current, 'dir')
  }
  return previousTarget
}

async function extractArchive(archivePath, targetDir) {
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  await execFileAsync('tar', ['-xzf', resolve(archivePath), '-C', resolve(targetDir)], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
  })
}

async function findExtractedBundle(tempDir) {
  const entries = await readdir(tempDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('she-companion-')) continue
    const candidate = join(tempDir, entry.name)
    if (await pathExists(join(candidate, 'VERSION')) && await pathExists(join(candidate, 'apps/companion/server.mjs'))) {
      return candidate
    }
  }
  return undefined
}

/**
 * Install a checksum-verified companion archive into a versioned directory and
 * switch `current`. Returns the previous symlink target for rollback.
 */
export async function installCompanionBundle(options) {
  const installRoot = resolve(String(options.installRoot ?? ''))
  if (installRoot === '') throw new Error('companion install root is required')
  const archivePath = resolve(String(options.archivePath ?? ''))
  const expectedVersion = String(options.expectedVersion ?? '').trim()
  if (!isSafeCompanionVersion(expectedVersion)) throw new Error('companion version is invalid')
  if (!await pathExists(archivePath)) throw new Error(`companion archive does not exist: ${archivePath}`)
  if (options.expectedSha256 !== undefined) {
    const actual = await sha256File(archivePath)
    if (actual !== String(options.expectedSha256).toLowerCase()) {
      throw new Error(`companion bundle SHA-256 mismatch: expected ${String(options.expectedSha256)} got ${actual}`)
    }
  }

  const staging = join(installRoot, 'staging')
  await mkdir(staging, { recursive: true, mode: 0o700 })
  const tempDir = join(staging, `extract-${randomUUID()}`)
  try {
    await extractArchive(archivePath, tempDir)
    const bundleDir = await findExtractedBundle(tempDir)
    if (bundleDir === undefined) throw new Error('invalid companion bundle: missing version/server entrypoint')
    const bundledVersion = (await readFile(join(bundleDir, 'VERSION'), 'utf8')).trim()
    if (bundledVersion !== expectedVersion) {
      throw new Error(`companion bundle version mismatch: expected ${expectedVersion} got ${bundledVersion}`)
    }
    const destination = join(installRoot, 'versions', expectedVersion)
    await mkdir(join(installRoot, 'versions'), { recursive: true, mode: 0o700 })
    if (await pathExists(destination)) await rm(destination, { recursive: true, force: true })
    await rename(bundleDir, destination)
    const previousTarget = await replaceCurrentPointer(installRoot, expectedVersion, options.platform ?? process.platform)
    await writeFile(join(installRoot, 'state.json'), `${JSON.stringify({
      schema: 1,
      current: expectedVersion,
      installedAt: new Date().toISOString(),
      ...(options.sourceArchive === undefined ? {} : { sourceArchive: options.sourceArchive }),
    }, null, 2)}\n`, { mode: 0o600 })
    await writeCompanionCommand({ installRoot, binDir: options.binDir, platform: options.platform ?? process.platform })
    return { version: expectedVersion, previousTarget, destination }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Write the user-visible command only when the stable launcher is present. */
export async function writeCompanionCommand(options) {
  const installRoot = resolve(String(options.installRoot ?? ''))
  const launcherPath = join(installRoot, 'launcher.mjs')
  if (!await pathExists(launcherPath)) return
  const binDir = options.binDir === undefined || String(options.binDir).trim() === ''
    ? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.local', 'bin')
    : resolve(String(options.binDir))
  await mkdir(binDir, { recursive: true, mode: 0o700 })
  if ((options.platform ?? process.platform) === 'win32') {
    const command = join(binDir, 'she-companion.cmd')
    const body = `@echo off\r\nset "SHE_COMPANION_ROOT=${installRoot}"\r\nset "SHE_BIN_DIR=${binDir}"\r\nnode "%SHE_COMPANION_ROOT%\\launcher.mjs" %*\r\n`
    await writeFile(command, body, { mode: 0o600 })
    return command
  }
  const command = join(binDir, 'she-companion')
  const body = `#!/usr/bin/env bash\nset -euo pipefail\nexport SHE_COMPANION_ROOT=${JSON.stringify(installRoot)}\nexport SHE_BIN_DIR=${JSON.stringify(binDir)}\nexec node "$SHE_COMPANION_ROOT/launcher.mjs" "$@"\n`
  await writeFile(command, body, { mode: 0o700 })
  await chmod(command, 0o755)
  return command
}
