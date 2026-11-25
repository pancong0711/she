#!/usr/bin/env node
/** Stable core-bundle entrypoint used by she-companion. */

import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const controlPlaneEntry = resolve(process.env.SHE_CONTROL_PLANE_ENTRY || resolve(here, 'apps/control-plane/dist/main.js'))
const brokerEntry = resolve(process.env.SHE_BROKER_ENTRY || resolve(here, 'apps/broker/dist/main.js'))
const nodeBin = process.execPath
const children = []
let shuttingDown = false

async function requireFile(path, label) {
  const info = await stat(path).catch(() => undefined)
  if (info === undefined || !info.isFile()) throw new Error(`${label} entrypoint not found: ${path}`)
}

function start(label, entry) {
  const child = spawn(nodeBin, [entry], {
    cwd: here,
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  children.push({ label, child })
  child.on('error', error => {
    process.stderr.write(`[run-core] ${label} spawn failed: ${error.message}\n`)
    void shutdown(1)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    process.stderr.write(`[run-core] ${label} exited code=${String(code)} signal=${String(signal)}\n`)
    void shutdown(code === 0 ? 1 : code ?? 1)
  })
  return child
}

async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  await new Promise(resolvePromise => setTimeout(resolvePromise, 300))
  for (const { child } of children) {
    if (!child.killed) child.kill('SIGKILL')
  }
  process.exit(code)
}

async function main() {
  if (process.env.SHE_CORE_SKIP_CONTROL_PLANE !== '1') await requireFile(controlPlaneEntry, 'control plane')
  if (process.env.SHE_CORE_SKIP_BROKER !== '1') await requireFile(brokerEntry, 'broker')
  if (process.env.SHE_CORE_SKIP_CONTROL_PLANE !== '1') start('control-plane', controlPlaneEntry)
  if (process.env.SHE_CORE_SKIP_BROKER !== '1') start('broker', brokerEntry)
  process.stdout.write(`[run-core] started with companion contract (pid ${String(process.pid)})\n`)
  if (process.env.SHE_CORE_SKIP_CONTROL_PLANE === '1' && process.env.SHE_CORE_SKIP_BROKER === '1') {
    throw new Error('both control-plane and broker are disabled; nothing to run')
  }
}

process.once('SIGINT', () => void shutdown(0))
process.once('SIGTERM', () => void shutdown(0))

await main()
