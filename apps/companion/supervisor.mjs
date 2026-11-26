#!/usr/bin/env node
/**
 * Stable companion process supervisor.
 *
 * The PWA cannot replace a process it is talking to. This supervisor owns the
 * actual companion child so the page can request a safe restart after a
 * checksum-verified update. It is only used by the one-click launchers.
 */

import { spawn } from 'node:child_process'
import { readFile, readlink, rename, rm, symlink, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const installRoot = process.env.SHE_COMPANION_ROOT?.trim() || resolve(here, '../../../..')
const currentPath = join(installRoot, 'current')
const pendingPath = join(installRoot, 'update-pending.json')
const RESTART_EXIT_CODE = 75
const STARTUP_GRACE_MS = 20_000
let child
let shuttingDown = false
let restarts = 0

function log(message) {
  process.stdout.write(`[she-supervisor] ${message}\n`)
}

async function cleanupPending(reason) {
  try {
    await rename(pendingPath, join(installRoot, `update-pending.${reason}.json`))
  } catch {}
}

async function rollbackIfPending() {
  try {
    const pending = JSON.parse(await readFile(pendingPath, 'utf8'))
    if (typeof pending?.previousTarget !== 'string') return false
    log(`rolling back companion to ${pending.previousTarget}`)
    await unlink(currentPath).catch(() => undefined)
    await symlink(pending.previousTarget, currentPath)
    await cleanupPending('rolled-back')
    return true
  } catch {
    return false
  }
}

function spawnCompanion() {
  const entry = join(currentPath, 'apps/companion/server.mjs')
  const startedAt = Date.now()
  child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      SHE_COMPANION_ROOT: installRoot,
      SHE_COMPANION_SUPERVISED: '1',
      SHE_SUPERVISOR_PID: String(process.pid),
    },
    stdio: 'inherit',
  })
  const pendingTimer = setTimeout(() => {
    void cleanupPending('accepted')
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
      log('restarting companion')
      spawnCompanion()
      return
    }
    const uptime = Date.now() - startedAt
    if (uptime < STARTUP_GRACE_MS && await rollbackIfPending()) {
      log('new companion exited during startup; restarting previous version')
      spawnCompanion()
      return
    }
    log(`companion exited unexpectedly: code=${String(code)} signal=${String(signal)}`)
    process.exit(code ?? 1)
  })
}

function forwardSignal(signal) {
  if (shuttingDown) return
  shuttingDown = true
  if (child !== undefined) child.kill(signal)
  setTimeout(() => process.exit(0), 5_000).unref()
}

process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))

log(`starting companion from ${installRoot}`)
spawnCompanion()
