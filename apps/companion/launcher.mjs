#!/usr/bin/env node
/**
 * Stable SHE companion launcher/supervisor.
 *
 * Installed once at `$SHE_COMPANION_ROOT/launcher.mjs` (and refreshed by a
 * checksum-verified `start.sh`/`start.ps1`). It owns the process lifecycle and
 * first install. Companion updates replace only `versions/<version>` and the
 * `current` pointer; this launcher stays outside that update target.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, resolveCompanionBundleUrl, validateCompanionManifest, validateCompanionManifestUrl } from './companion-update.mjs'
import { installCompanionBundle, writeCompanionCommand } from './companion-installer.mjs'

export const LAUNCHER_VERSION = '2'
const RESTART_EXIT_CODE = 75
const STARTUP_GRACE_MS = 20_000
const installRoot = resolve(process.env.SHE_COMPANION_ROOT?.trim() || join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.local', 'share', 'she', 'companion'))
const binDir = resolve(process.env.SHE_BIN_DIR?.trim() || join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.local', 'bin'))
const port = Number(process.env.SHE_PWA_PORT ?? 8787)
const manifestUrl = process.env.SHE_COMPANION_MANIFEST_URL?.trim()
  || 'https://pancong0711.github.io/she/companion-release-manifest.json'
const currentPath = join(installRoot, 'current')
const pendingPath = join(installRoot, 'update-pending.json')
// Check for a newer companion on every launcher start by default. Set
// SHE_LAUNCHER_UPDATE_ON_START=0 to force a fully offline start.
const checkUpdateOnStart = process.env.SHE_LAUNCHER_UPDATE_ON_START !== '0'
let child
let shuttingDown = false
let restarts = 0

function log(message) {
  process.stdout.write(`[she-launcher] ${message}\n`)
}

function describeNetworkError(error) {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause
  return cause instanceof Error ? `${error.message} (${cause.message})` : error.message
}

function runCurl(args, timeoutMs) {
  return new Promise(resolvePromise => {
    const stdout = []
    const stderr = []
    let settled = false
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(result)
    }
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    child.on('error', error => finish({ ok: false, detail: error.message }))
    child.on('close', code => finish({
      ok: code === 0,
      detail: Buffer.concat(stderr).toString('utf8').trim() || Buffer.concat(stdout).toString('utf8').trim() || `curl exited ${String(code)}`,
    }))
  })
}

/**
 * Use Node fetch first, then system curl. This mirrors the companion server's
 * recovery path for hosts where curl can reach GitHub but Node's fetch stack
 * cannot (DNS/proxy/TLS differences).
 */
async function downloadBytesWithCurlFallback(url, timeoutMs) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  } catch (fetchError) {
    const tempDir = await mkdtemp(join(tmpdir(), 'she-launcher-download-'))
    const target = join(tempDir, 'download')
    try {
      const curl = await runCurl([
        '-fL', '--retry', '3', '--connect-timeout', '20', '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1000))), '-o', target, url,
      ], timeoutMs + 10_000)
      if (!curl.ok) {
        throw new Error(`fetch failed for ${url}: ${describeNetworkError(fetchError)}; curl fallback failed: ${curl.detail}`)
      }
      return await readFile(target)
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

async function readCurrentVersion() {
  try {
    return (await readFile(join(currentPath, 'VERSION'), 'utf8')).trim()
  } catch {
    return undefined
  }
}

async function fetchManifest(url) {
  const validated = validateCompanionManifestUrl(url)
  const bytes = validated.startsWith('file://')
    ? await readFile(new URL(validated))
    : await downloadBytesWithCurlFallback(validated, 20_000)
  return validateCompanionManifest(JSON.parse(bytes.toString('utf8')))
}

async function downloadBundle(manifest) {
  const file = String(manifest.bundle.file).replace(/\\/g, '/').split('/').pop()
  if (!file) throw new Error('invalid companion bundle file name')
  const url = new URL(resolveCompanionBundleUrl(manifestUrl, manifest))
  const staging = join(installRoot, 'staging')
  await mkdir(staging, { recursive: true, mode: 0o700 })
  const target = join(staging, file)
  let bytes
  if (url.protocol === 'file:') {
    bytes = await readFile(url)
  } else {
    bytes = await downloadBytesWithCurlFallback(url.href, 120_000)
  }
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== String(manifest.bundle.sha256).toLowerCase()) {
    throw new Error(`companion bundle SHA-256 mismatch: expected ${String(manifest.bundle.sha256)} got ${actual}`)
  }
  await writeFile(target, bytes, { mode: 0o600 })
  return { path: target, sha256: actual }
}

async function ensureInstalled(targetManifest) {
  const currentVersion = await readCurrentVersion()
  if (currentVersion === targetManifest.version) return currentVersion
  log(`installing companion ${targetManifest.version}${currentVersion === undefined ? '' : ` (current ${currentVersion})`}`)
  const download = await downloadBundle(targetManifest)
  await installCompanionBundle({
    archivePath: download.path,
    expectedVersion: targetManifest.version,
    expectedSha256: download.sha256,
    installRoot,
    binDir,
    platform: process.platform,
    sourceArchive: download.path.split(/[\\/]/).pop(),
  })
  await writeCompanionCommand({ installRoot, binDir, platform: process.platform })
  return targetManifest.version
}

async function removeCurrentPointer() {
  try {
    const info = await lstat(currentPath)
    if (info.isSymbolicLink() || info.isFile()) {
      if (process.platform === 'win32') {
        try {
          await unlink(currentPath)
        } catch {
          await rm(currentPath, { recursive: true, force: true })
        }
      } else {
        await unlink(currentPath)
      }
      return
    }
    await rm(currentPath, { recursive: true, force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function switchToTarget(target) {
  const resolvedTarget = process.platform === 'win32' ? resolve(installRoot, target) : target
  await removeCurrentPointer()
  await symlink(resolvedTarget, currentPath, process.platform === 'win32' ? 'junction' : 'dir')
}

async function readPending() {
  try {
    return JSON.parse(await readFile(pendingPath, 'utf8'))
  } catch {
    return undefined
  }
}

async function clearPending(reason) {
  const pending = await readPending()
  if (pending === undefined) return
  await rename(pendingPath, join(installRoot, `update-pending.${reason}.json`)).catch(() => undefined)
}

async function rollbackIfPending(reason = 'rolled-back') {
  const pending = await readPending()
  if (pending === undefined || typeof pending.previousTarget !== 'string') return false
  log(`rolling back companion to ${pending.previousTarget}`)
  await switchToTarget(pending.previousTarget)
  await clearPending(reason)
  return true
}

function spawnCompanion() {
  const entry = join(currentPath, 'apps/companion/server.mjs')
  const startedAt = Date.now()
  child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      SHE_COMPANION_ROOT: installRoot,
      SHE_BIN_DIR: binDir,
      SHE_COMPANION_SUPERVISED: '1',
      SHE_SUPERVISOR_PID: String(process.pid),
      SHE_LAUNCHER_VERSION: LAUNCHER_VERSION,
    },
    stdio: 'inherit',
  })
  const pendingTimer = setTimeout(() => {
    void clearPending('accepted')
  }, STARTUP_GRACE_MS)
  pendingTimer.unref()
  const stableTimer = setTimeout(() => {
    restarts = 0
  }, 60_000)
  stableTimer.unref()

  child.on('error', error => {
    clearTimeout(pendingTimer)
    clearTimeout(stableTimer)
    log(`failed to start companion: ${error.message}`)
    process.exit(1)
  })
  child.on('exit', async (code, signal) => {
    clearTimeout(pendingTimer)
    clearTimeout(stableTimer)
    if (shuttingDown) {
      process.exit(code ?? 0)
      return
    }
    if (code === 0) {
      log('companion requested shutdown')
      process.exit(0)
    }
    if (code === RESTART_EXIT_CODE) {
      restarts += 1
      if (restarts > 5) {
        log('too many restart requests; exiting')
        process.exit(1)
      }
      log('restarting companion from current version')
      spawnCompanion()
      return
    }
    const uptime = Date.now() - startedAt
    if (uptime < STARTUP_GRACE_MS && await rollbackIfPending()) {
      log('new companion exited during startup; restarted previous version')
      spawnCompanion()
      return
    }
    log(`companion exited unexpectedly: code=${String(code)} signal=${String(signal)}`)
    process.exit(code ?? 1)
  })
}

async function probeRunningCompanion() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return undefined
    const payload = await response.json()
    return payload?.value ?? undefined
  } catch {
    return undefined
  }
}

async function updateRunningCompanion(existing, manifest) {
  const comparison = compareVersions(manifest.version, String(existing.version ?? ''))
  if (comparison === undefined || comparison <= 0) return false
  if (existing.supervised !== true) {
    throw new Error(`companion ${existing.version} is running without a supervisor; start the new launcher after stopping it once`)
  }
  log(`requesting running companion ${existing.version} update to ${manifest.version}`)
  const response = await fetch(`http://127.0.0.1:${port}/api/companion/update/apply`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-she-local-action': '1' },
    body: JSON.stringify({ manifestUrl }),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => undefined)
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error?.message ?? `running companion rejected update: HTTP ${response.status}`)
  }
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 750))
    const next = await probeRunningCompanion()
    if (next !== undefined && next.version === manifest.version) return true
  }
  throw new Error(`companion update to ${manifest.version} did not become reachable within 60 seconds`)
}

function openBrowser() {
  if (process.env.SHE_NO_BROWSER === '1') return
  const url = `http://127.0.0.1:${port}`
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const opener = spawn(command, args, { detached: true, stdio: 'ignore' })
    opener.unref()
  } catch {}
}

async function main() {
  await mkdir(installRoot, { recursive: true, mode: 0o700 })
  await writeCompanionCommand({ installRoot, binDir, platform: process.platform })

  const existing = await probeRunningCompanion()
  if (existing !== undefined) {
    if (checkUpdateOnStart) {
      try {
        log(`checking companion updates from ${manifestUrl}`)
        const manifest = await fetchManifest(manifestUrl)
        if (await updateRunningCompanion(existing, manifest)) {
          log(`running companion updated to ${manifest.version}`)
          openBrowser()
          return
        }
      } catch (error) {
        log(`running companion update skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    log(`companion ${existing.version ?? 'unknown'} is already running at http://127.0.0.1:${port}`)
    openBrowser()
    return
  }

  let currentVersion = await readCurrentVersion()
  if (currentVersion === undefined) {
    const manifest = await fetchManifest(manifestUrl)
    currentVersion = await ensureInstalled(manifest)
  } else if (checkUpdateOnStart) {
    try {
      log(`checking companion updates from ${manifestUrl}`)
      const manifest = await fetchManifest(manifestUrl)
      const comparison = compareVersions(manifest.version, currentVersion)
      if (comparison !== undefined && comparison > 0) currentVersion = await ensureInstalled(manifest)
    } catch (error) {
      log(`update check unavailable; using installed companion ${currentVersion}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (await readPending() !== undefined) {
    // A previous process may have switched current and exited. Start it; the
    // normal startup grace/rollback path below handles a bad release.
    log('found pending companion update marker; validating new version at startup')
  }
  log(`starting companion ${currentVersion} from ${installRoot}`)
  openBrowser()
  spawnCompanion()
}

function forwardSignal(signal) {
  if (shuttingDown) return
  shuttingDown = true
  if (child !== undefined) child.kill(signal)
  setTimeout(() => process.exit(0), 5_000).unref()
}

process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    log(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exit(1)
  })
}
