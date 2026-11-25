#!/usr/bin/env node
/**
 * Stable local SHE companion.
 *
 * Serves a static PWA build, proxies control-plane/broker APIs over local Unix
 * sockets, and runs allowlisted install/diagnostic jobs. It binds 127.0.0.1
 * only. This layer must not import SHE core/control/broker implementation code.
 */

import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, readlink, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const distDir = process.env.SHE_PWA_DIST?.trim()
  ? resolve(process.env.SHE_PWA_DIST.trim())
  : resolve(repoRoot, 'apps/pwa/dist')
const companionVersion = JSON.parse(await readFile(join(here, 'package.json'), 'utf8')).version
const userBin = join(homedir(), '.local', 'bin')
const childEnv = {
  ...process.env,
  PATH: `${userBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
}
const host = '127.0.0.1'
const port = Number(process.env.SHE_PWA_PORT ?? 8787)
const runtimeHome = process.env.XDG_RUNTIME_DIR?.trim() || join(homedir(), '.local', 'run')
const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
const dataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
const coreRoot = process.env.SHE_CORE_ROOT?.trim() || join(dataHome, 'she', 'core')
const controlSocketPath = process.env.SHE_CONTROL_SOCKET?.trim() || join(runtimeHome, 'she', 'control.sock')
const controlTokenFile = process.env.SHE_TOKEN_FILE?.trim() || join(configHome, 'she', 'token')
const brokerSocketPath = process.env.SHE_BROKER_SOCKET?.trim() || join(runtimeHome, 'she', 'broker.sock')
const brokerTokenFile = process.env.SHE_BROKER_TOKEN_FILE?.trim() || join(configHome, 'she', 'broker-token')
const allowedOrigins = new Set(
  (process.env.SHE_ALLOWED_ORIGINS
    ?? 'https://pancong0711.github.io,http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
)

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
])

async function readToken(path) {
  try {
    const value = (await readFile(path, 'utf8')).trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

function securityHeaders(response, contentType) {
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-frame-options', 'DENY')
  response.setHeader(
    'content-security-policy',
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; manifest-src 'self'; worker-src 'self' blob:",
  )
  if (contentType !== undefined) response.setHeader('content-type', contentType)
}

const JOB_KINDS = new Map([
  ['doctor', '环境检查'],
  ['bootstrap', '用户级环境准备'],
  ['install', '安装依赖'],
  ['build', '构建 PWA'],
  ['build-all', '构建全部'],
  ['test', '运行测试'],
  ['core-update', 'Core 更新'],
])
const jobs = new Map()
let activeJobId = null
let lastPreflight = null
let coreChild = null
let coreStartedAt = null
let coreLastError = null
let lastUpdate = null
const coreLogs = []

function jobSummary(job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    exitCode: job.exitCode ?? null,
  }
}

function appendJobEvent(job, event) {
  const value = { at: Date.now(), ...event }
  job.events.push(value)
  for (const listener of job.listeners) listener(value)
}

function appendLog(job, stream, text) {
  const lines = String(text).replace(/\r/g, '').split('\n')
  for (const line of lines) {
    if (line === '') continue
    appendJobEvent(job, { type: 'log', stream, text: line })
  }
}

function runCommand(job, command, args, { allowFailure = false } = {}) {
  appendJobEvent(job, { type: 'system', text: `$ ${[command, ...args].join(' ')}` })
  return new Promise(resolvePromise => {
    let settled = false
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...childEnv, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const finish = result => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }
    child.stdout.on('data', chunk => appendLog(job, 'stdout', chunk.toString('utf8')))
    child.stderr.on('data', chunk => appendLog(job, 'stderr', chunk.toString('utf8')))
    child.on('error', error => {
      appendJobEvent(job, { type: 'system', text: `spawn failed: ${error.message}` })
      if (allowFailure) finish({ code: 127, ok: false })
      else finish({ code: 127, ok: false })
    })
    child.on('close', code => finish({ code: code ?? 1, ok: code === 0 || allowFailure }))
  })
}

function captureCommand(job, command, args) {
  appendJobEvent(job, { type: 'system', text: `$ ${[command, ...args].join(' ')}` })
  return new Promise(resolvePromise => {
    let settled = false
    const stdout = []
    const stderr = []
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...childEnv, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const finish = result => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }
    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8')
      stdout.push(text)
      appendLog(job, 'stdout', text)
    })
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8')
      stderr.push(text)
      appendLog(job, 'stderr', text)
    })
    child.on('error', error => {
      appendJobEvent(job, { type: 'system', text: `spawn failed: ${error.message}` })
      finish({ code: 127, ok: false, stdout: '', stderr: error.message })
    })
    child.on('close', code => finish({
      code: code ?? 1,
      ok: code === 0,
      stdout: stdout.join('').trim(),
      stderr: stderr.join('').trim(),
    }))
  })
}

function parseMajorMinor(version) {
  const match = /^v?([0-9]+)\.([0-9]+)/.exec(version.trim())
  return match === null ? undefined : { major: Number(match[1]), minor: Number(match[2]) }
}

function nodeVersionSupported(version) {
  const parsed = parseMajorMinor(version)
  if (parsed === undefined) return false
  return parsed.major === 22 ? parsed.minor >= 19 : parsed.major >= 24
}

function pnpmVersionSupported(version) {
  const parsed = parseMajorMinor(version)
  if (parsed === undefined) return false
  return parsed.major > 11 || (parsed.major === 11 && parsed.minor >= 22)
}

async function runPreflight(job) {
  const checks = []
  const add = (status, label, detail) => {
    const check = { type: 'check', status, label, detail }
    checks.push(check)
    appendJobEvent(job, check)
  }
  const checkPath = async (label, path) => {
    try {
      const info = await stat(path)
      const kind = info.isSocket() ? 'socket' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'path'
      add('ok', label, `${path} (${kind})`)
    } catch {
      add('warn', label, `missing: ${path}`)
    }
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  add(uid === 0 ? 'fail' : 'ok', 'user', uid === undefined ? 'uid unavailable on this platform' : uid === 0 ? 'SHE companion must not run as root' : `uid=${String(uid)}; no sudo/root execution`)

  const nodeVersion = process.versions.node
  add(nodeVersionSupported(nodeVersion) ? 'ok' : 'fail', 'Node.js', `v${nodeVersion}; required ^22.19.0 || >=24.0.0`)

  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const pnpmResult = await captureCommand(job, pnpmCommand, ['--version'])
  add(pnpmResult.ok && pnpmVersionSupported(pnpmResult.stdout) ? 'ok' : 'fail', 'pnpm', pnpmResult.ok ? `${pnpmResult.stdout}; required >=11.22.0` : pnpmResult.stderr || 'not found')

  const gitResult = await captureCommand(job, 'git', ['--version'])
  add(gitResult.ok ? 'ok' : 'warn', 'git', gitResult.ok ? gitResult.stdout : (gitResult.stderr || 'not installed; needed for clone/update'))

  const dockerResult = await captureCommand(job, 'docker', ['version', '--format', '{{.Server.Version}}'])
  const dockerSecurity = await captureCommand(job, 'docker', ['info', '--format', '{{json .SecurityOptions}}'])
  if (!dockerResult.ok) {
    add('warn', 'Docker runtime', dockerResult.stderr || 'not available; sandbox features will be degraded. Install/configure Docker yourself if needed; SHE will not request root.')
  } else if (dockerSecurity.ok && dockerSecurity.stdout.includes('rootless')) {
    add('ok', 'Docker runtime', `rootless Docker ${dockerResult.stdout}`)
  } else {
    add('warn', 'Docker runtime', `Docker ${dockerResult.stdout} is accessible to this user but not detected as rootless; access may be root-equivalent. SHE does not request or execute root.`)
  }

  await checkPath('control-plane build', join(repoRoot, 'apps/control-plane/dist/main.js'))
  await checkPath('broker build', join(repoRoot, 'apps/broker/dist/main.js'))
  await checkPath('PWA build', join(distDir, 'index.html'))
  await checkPath('control socket', controlSocketPath)
  await checkPath('broker socket', brokerSocketPath)

  const ok = checks.filter(check => check.type === 'check' && check.status === 'fail').length === 0
  lastPreflight = { at: Date.now(), ok, checks }
  appendJobEvent(job, { type: 'system', text: ok ? 'preflight passed' : 'preflight failed; install/build actions may be unsafe to continue' })
  return { ok, checks }
}


function recordCoreOutput(stream, text, job) {
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (line === '') continue
    coreLogs.push({ at: Date.now(), stream, text: line })
    while (coreLogs.length > 300) coreLogs.shift()
    if (job !== undefined) appendJobEvent(job, { type: 'log', stream, text: line })
  }
}

async function readCurrentCoreVersion() {
  try {
    const target = await readlink(join(coreRoot, 'current'))
    const version = (await readFile(join(coreRoot, 'current', 'VERSION'), 'utf8')).trim()
    return { target, version }
  } catch {
    return undefined
  }
}

async function readPreviousCoreVersion() {
  try {
    const target = await readlink(join(coreRoot, 'previous'))
    const version = (await readFile(join(coreRoot, 'previous', 'VERSION'), 'utf8')).trim()
    return { target, version }
  } catch {
    return undefined
  }
}

async function coreStatus() {
  const [current, previous, controlPlane, broker] = await Promise.all([
    readCurrentCoreVersion(),
    readPreviousCoreVersion(),
    probeSocket(controlSocketPath, controlTokenFile),
    probeSocket(brokerSocketPath, brokerTokenFile),
  ])
  return {
    supervisor: {
      state: coreChild === null ? 'stopped' : 'running',
      pid: coreChild?.pid ?? null,
      startedAt: coreStartedAt,
      lastError: coreLastError,
      logs: coreLogs.slice(-20),
    },
    installed: {
      root: coreRoot,
      current: current?.version ?? null,
      currentTarget: current?.target ?? null,
      previous: previous?.version ?? null,
      previousTarget: previous?.target ?? null,
    },
    controlPlane,
    broker,
    lastUpdate,
  }
}

async function startCore(job) {
  if (coreChild !== null) return { alreadyRunning: true }
  const entry = process.platform === 'win32'
    ? join(coreRoot, 'current', 'run-core.cmd')
    : join(coreRoot, 'current', 'run-core.sh')
  await access(entry)
  coreLastError = null
  coreStartedAt = Date.now()
  const command = process.platform === 'win32' ? 'cmd' : 'bash'
  const args = process.platform === 'win32' ? ['/c', entry] : [entry]
  if (job !== undefined) appendJobEvent(job, { type: 'system', text: `starting core: ${entry}` })
  const child = spawn(command, args, {
    cwd: join(coreRoot, 'current'),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  coreChild = child
  child.stdout.on('data', chunk => recordCoreOutput('stdout', chunk.toString('utf8'), job))
  child.stderr.on('data', chunk => recordCoreOutput('stderr', chunk.toString('utf8'), job))
  child.on('error', error => {
    coreLastError = error.message
    recordCoreOutput('stderr', `core spawn failed: ${error.message}`, job)
  })
  child.on('exit', (code, signal) => {
    recordCoreOutput('stderr', `core exited code=${String(code)} signal=${String(signal)}`, job)
    coreChild = null
    coreStartedAt = null
    if (code !== 0 && code !== null) coreLastError = `core exited with code ${String(code)}`
  })
  return { started: true, pid: child.pid }
}

async function stopCore(job) {
  const child = coreChild
  if (child === null) return { stopped: false }
  if (job !== undefined) appendJobEvent(job, { type: 'system', text: 'stopping core' })
  const exited = new Promise(resolvePromise => child.once('exit', () => resolvePromise(true)))
  child.kill('SIGTERM')
  const graceful = await Promise.race([
    exited,
    new Promise(resolvePromise => setTimeout(() => resolvePromise(false), 5_000)),
  ])
  if (!graceful) child.kill('SIGKILL')
  coreChild = null
  coreStartedAt = null
  return { stopped: true }
}

async function waitForCoreHealthy(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // A stale socket from a previous process is not proof that the newly
    // spawned core is healthy. The supervisor must still be alive.
    if (coreChild === null) {
      return { ok: false, error: coreLastError ?? 'core process exited before health check' }
    }
    const [control, broker] = await Promise.all([
      probeSocket(controlSocketPath, controlTokenFile),
      probeSocket(brokerSocketPath, brokerTokenFile),
    ])
    if (control.reachable && broker.reachable) return { ok: true, control, broker }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
  }
  const [control, broker] = await Promise.all([
    probeSocket(controlSocketPath, controlTokenFile),
    probeSocket(brokerSocketPath, brokerTokenFile),
  ])
  return { ok: false, control, broker, error: coreLastError ?? 'health check timed out' }
}

async function rollbackCore(job) {
  const previous = await readPreviousCoreVersion()
  if (previous === undefined) throw new Error('no previous core version available for rollback')
  appendJobEvent(job, { type: 'system', text: `rolling back core to ${previous.version}` })
  await unlink(join(coreRoot, 'current')).catch(() => undefined)
  await symlink(previous.target, join(coreRoot, 'current'))
  await writeFile(join(coreRoot, 'state.json'), `${JSON.stringify({ schema: 1, current: previous.version, rolledBackAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 })
  await startCore(job)
  return waitForCoreHealthy()
}

async function readManifest(url) {
  if (url.startsWith('file://')) {
    return JSON.parse(await readFile(new URL(url), 'utf8'))
  }
  if (!/^https?:\/\//.test(url)) throw new Error('manifest URL must be http(s) or file://')
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`manifest HTTP ${response.status}`)
  return await response.json()
}

async function downloadBundle(manifestUrl, manifest, job) {
  const file = manifest?.bundle?.file
  const expected = manifest?.bundle?.sha256
  if (typeof file !== 'string' || typeof expected !== 'string') throw new Error('manifest bundle.file/sha256 missing')
  const url = manifestUrl.startsWith('file://')
    ? new URL(file, manifestUrl).href
    : new URL(file, manifestUrl).href
  appendJobEvent(job, { type: 'system', text: `downloading bundle: ${url}` })
  let bytes
  if (url.startsWith('file://')) {
    bytes = await readFile(new URL(url))
  } else if (/^https?:\/\//.test(url)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`bundle HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  } else {
    throw new Error('bundle URL must be http(s) or file://')
  }
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`bundle SHA-256 mismatch: expected ${expected}, got ${actual}`)
  const staging = join(coreRoot, 'staging')
  await mkdir(staging, { recursive: true, mode: 0o700 })
  const target = join(staging, basename(file))
  await writeFile(target, bytes, { mode: 0o600 })
  return { path: target, sha256: actual, bytes: bytes.byteLength }
}

async function executeCoreUpdate(job) {
  const manifestUrl = String(job.input?.manifestUrl ?? '').trim()
  if (manifestUrl === '') throw new Error('manifestUrl is required')
  const manifest = await readManifest(manifestUrl)
  if (manifest?.schema !== 1 || typeof manifest?.version !== 'string') throw new Error('unsupported release manifest')
  const current = await readCurrentCoreVersion()
  lastUpdate = { at: Date.now(), manifestUrl, from: current?.version ?? null, to: manifest.version, status: 'downloading' }
  appendJobEvent(job, { type: 'system', text: `core update ${current?.version ?? 'none'} -> ${manifest.version}` })
  const download = await downloadBundle(manifestUrl, manifest, job)
  const pending = {
    schema: 1,
    version: manifest.version,
    bundle: download,
    manifestUrl,
    createdAt: Date.now(),
  }
  await writeFile(join(coreRoot, 'pending.json'), `${JSON.stringify(pending, null, 2)}\n`, { mode: 0o600 })
  lastUpdate.status = 'stopping'
  await stopCore(job)
  const installScript = join(repoRoot, 'scripts/install-core-bundle.sh')
  const install = await runCommand(job, 'bash', [installScript, download.path, '--sha256', download.sha256, '--core-root', coreRoot])
  if (!install.ok) throw new Error('core bundle installation failed')
  lastUpdate.status = 'starting'
  await startCore(job)
  const health = await waitForCoreHealthy()
  if (!health.ok) {
    lastUpdate.status = 'rolling-back'
    await stopCore(job)
    const rolled = await rollbackCore(job)
    lastUpdate.status = rolled.ok ? 'rolled-back' : 'failed'
    throw new Error(`new core failed health check (${health.error ?? 'unhealthy'}); rollback ${rolled.ok ? 'succeeded' : 'failed'}`)
  }
  await unlink(join(coreRoot, 'pending.json')).catch(() => undefined)
  lastUpdate.status = 'succeeded'
  appendJobEvent(job, { type: 'system', text: `core ${manifest.version} is healthy` })
}

async function checkCoreUpdate(manifestUrl) {
  const manifest = await readManifest(manifestUrl)
  const current = await readCurrentCoreVersion()
  return {
    current: current?.version ?? null,
    available: typeof manifest?.version === 'string' ? manifest.version : null,
    needsUpdate: typeof manifest?.version === 'string' && manifest.version !== current?.version,
    manifest,
  }
}

async function executeJob(job) {
  job.status = 'running'
  job.startedAt = Date.now()
  appendJobEvent(job, { type: 'status', status: 'running' })
  try {
    if (job.kind === 'doctor') {
      const preflight = await runPreflight(job)
      job.exitCode = preflight.ok ? 0 : 1
    } else if (job.kind === 'bootstrap') {
      const isWindows = process.platform === 'win32'
      const result = isWindows
        ? await runCommand(job, 'powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(repoRoot, 'scripts/bootstrap-user.ps1'), 'install-pnpm'])
        : await runCommand(job, 'bash', [join(repoRoot, 'scripts/bootstrap-user.sh'), '--install-pnpm'])
      job.exitCode = result.code
      if (result.ok) await runPreflight(job)
    } else if (job.kind === 'install') {
      // Hard gate: never install dependencies before the local toolchain passes
      // the minimum preflight. This prevents a half-installed environment.
      const preflight = await runPreflight(job)
      if (!preflight.ok) {
        appendJobEvent(job, { type: 'system', text: 'install aborted: fix failing preflight checks first' })
        job.exitCode = 1
      } else {
        const result = await runCommand(job, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['install', '--frozen-lockfile'])
        job.exitCode = result.code
      }
    } else if (job.kind === 'build') {
      const result = await runCommand(job, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['pwa:build'])
      job.exitCode = result.code
    } else if (job.kind === 'build-all') {
      const result = await runCommand(job, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build'])
      job.exitCode = result.code
    } else if (job.kind === 'test') {
      const result = await runCommand(job, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['test'])
      job.exitCode = result.code
    } else if (job.kind === 'core-update') {
      await executeCoreUpdate(job)
      job.exitCode = 0
    } else {
      throw new Error(`unsupported job kind: ${job.kind}`)
    }
    job.status = job.exitCode === 0 ? 'succeeded' : 'failed'
  } catch (error) {
    appendJobEvent(job, { type: 'system', text: `job failed: ${error.message}` })
    job.exitCode = 1
    job.status = 'failed'
  } finally {
    job.finishedAt = Date.now()
    appendJobEvent(job, { type: 'done', status: job.status, exitCode: job.exitCode ?? 1 })
    activeJobId = null
  }
}

function startJob(kind, input = {}) {
  if (!JOB_KINDS.has(kind)) throw new Error(`unsupported job kind: ${kind}`)
  if (activeJobId !== null) throw new Error('another install/debug job is already running')
  const job = {
    id: `job-${randomUUID()}`,
    kind,
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    input,
    events: [],
    listeners: new Set(),
  }
  jobs.set(job.id, job)
  activeJobId = job.id
  while (jobs.size > 20) {
    const oldest = [...jobs.values()].find(item => item.status !== 'running' && item.status !== 'queued')
    if (oldest === undefined) break
    jobs.delete(oldest.id)
  }
  void executeJob(job)
  return job
}

function probeSocket(socketPath, tokenFile) {
  return new Promise(resolvePromise => {
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }
    readToken(tokenFile).then(token => {
      const request = httpRequest({
        socketPath,
        path: '/v1/health',
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        timeout: 3_000,
      }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let body = null
          try { body = text === '' ? null : JSON.parse(text) } catch {}
          finish({
            reachable: true,
            httpStatus: response.statusCode ?? 0,
            ...(body === null ? {} : { response: body }),
          })
        })
      })
      request.on('timeout', () => {
        request.destroy()
        finish({ reachable: false, error: 'timeout' })
      })
      request.on('error', error => finish({ reachable: false, error: error.message }))
      request.end()
    }).catch(error => finish({ reachable: false, error: error.message }))
  })
}

async function readBodyJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJsonWithCors(request, response, status, payload) {
  const cors = corsHeaders(request)
  if (cors === undefined) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'origin is not allowed', retryable: false } }))
    return
  }
  response.writeHead(status, { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}

async function handleCompanionApi(request, response) {
  const cors = corsHeaders(request)
  if (cors === undefined) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'origin is not allowed', retryable: false } }))
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    response.end()
    return
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJsonWithCors(request, response, 200, {
      ok: true,
      value: {
        status: 'ok',
        pid: process.pid,
        repoRoot,
        distDir,
        controlSocketPath,
        brokerSocketPath,
        activeJobId,
        version: companionVersion,
        privilege: {
          rootRequired: false,
          executesSudo: false,
          privilegedInstall: 'instructions-only',
        },
      },
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/version') {
    sendJsonWithCors(request, response, 200, {
      ok: true,
      value: {
        companion: companionVersion,
        node: process.version,
        repoRoot,
        distDir,
        protocols: {
          companionApi: 'v1',
          gateway: 'v1',
          agent: 'v1',
          sandbox: 'v1',
        },
      },
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/capabilities') {
    sendJsonWithCors(request, response, 200, {
      ok: true,
      value: {
        jobs: [...JOB_KINDS.keys()],
        api: ['health', 'version', 'capabilities', 'jobs', 'events', 'core-status', 'core-start-stop-restart', 'core-update-check', 'preflight'],
        streams: ['ndjson'],
        installs: ['job-based-allowlist'],
        privilege: { rootRequired: false, executesSudo: false, privilegedInstall: 'instructions-only' },
      },
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/core/status') {
    const status = await coreStatus()
    sendJsonWithCors(request, response, 200, {
      ok: true,
      value: { companion: companionVersion, ...status },
    })
    return
  }
  if (request.method === 'POST' && /^\/api\/core\/(start|stop|restart)$/.test(url.pathname)) {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    const action = url.pathname.split('/').pop()
    try {
      if (action === 'start') await startCore()
      else if (action === 'stop') await stopCore()
      else { await stopCore(); await startCore() }
      const health = action === 'stop' ? { ok: true } : await waitForCoreHealthy()
      sendJsonWithCors(request, response, 200, { ok: true, value: { action, health, status: await coreStatus() } })
    } catch (error) {
      sendJsonWithCors(request, response, 409, { ok: false, error: { code: 'conflict', message: error.message, retryable: true } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/core/update/check') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      const result = await checkCoreUpdate(String(body.manifestUrl ?? '').trim())
      sendJsonWithCors(request, response, 200, { ok: true, value: result })
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/preflight') {
    sendJsonWithCors(request, response, 200, {
      ok: true,
      value: lastPreflight ?? { at: null, ok: null, checks: [] },
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/jobs') {
    sendJsonWithCors(request, response, 200, { ok: true, value: [...jobs.values()].map(jobSummary).reverse() })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/jobs') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      const job = startJob(String(body.kind ?? ''), body)
      sendJsonWithCors(request, response, 202, { ok: true, value: jobSummary(job) })
    } catch (error) {
      sendJsonWithCors(request, response, 409, { ok: false, error: { code: 'conflict', message: error.message, retryable: false } })
    }
    return
  }
  const match = /^\/api\/jobs\/([^/]+)(?:\/(events))?$/.exec(url.pathname)
  if (match !== null) {
    const job = jobs.get(decodeURIComponent(match[1]))
    if (job === undefined) {
      sendJsonWithCors(request, response, 404, { ok: false, error: { code: 'not_found', message: 'job not found', retryable: false } })
      return
    }
    if (match[2] === 'events' && request.method === 'GET') {
      response.writeHead(200, { ...cors, 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', connection: 'keep-alive' })
      for (const event of job.events) response.write(`${JSON.stringify(event)}\n`)
      if (job.status === 'succeeded' || job.status === 'failed') {
        response.end()
        return
      }
      const listener = event => {
        response.write(`${JSON.stringify(event)}\n`)
        if (event.type === 'done') {
          job.listeners.delete(listener)
          response.end()
        }
      }
      job.listeners.add(listener)
      request.on('close', () => job.listeners.delete(listener))
      return
    }
    if (request.method === 'GET') {
      sendJsonWithCors(request, response, 200, { ok: true, value: jobSummary(job) })
      return
    }
  }
  sendJsonWithCors(request, response, 404, { ok: false, error: { code: 'not_found', message: 'unknown companion API', retryable: false } })
}

function corsHeaders(request) {
  const origin = request.headers.origin
  if (origin === undefined) return {}
  if (!allowedOrigins.has(origin)) return undefined
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, accept, x-she-local-action',
    'access-control-expose-headers': 'content-type',
    'access-control-max-age': '600',
    'access-control-allow-private-network': 'true',
    vary: 'Origin',
  }
}

async function proxyApi(request, response, target) {
  const cors = corsHeaders(request)
  if (cors === undefined) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({
      ok: false,
      error: { code: 'forbidden', message: 'origin is not allowed to access the SHE companion', retryable: false },
    }))
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    response.end()
    return
  }
  const token = await readToken(target.tokenFile)
  const headers = { ...request.headers }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  delete headers.host

  const proxy = httpRequest({
    socketPath: target.socketPath,
    path: target.rewritePath(request.url ?? '/'),
    method: request.method,
    headers,
  }, upstream => {
    response.writeHead(upstream.statusCode ?? 502, { ...upstream.headers, ...cors })
    upstream.pipe(response)
  })
  proxy.on('error', error => {
    if (response.headersSent) {
      response.destroy()
      return
    }
    const body = JSON.stringify({
      ok: false,
      error: {
        code: 'unavailable',
        message: `${target.label} unavailable: ${error.message}`,
        retryable: true,
        details: { socketPath: target.socketPath },
      },
    })
    response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
    response.end(body)
  })
  request.pipe(proxy)
}

async function serveStatic(request, response) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    response.writeHead(400)
    response.end('bad request')
    return
  }
  const candidate = resolve(distDir, `.${pathname}`)
  const rel = relative(distDir, candidate)
  if (rel.startsWith('..') || rel.includes('..')) {
    response.writeHead(403)
    response.end('forbidden')
    return
  }
  let file = candidate
  let spaFallback = false
  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
  } catch {
    if (extname(pathname) === '') {
      file = join(distDir, 'index.html')
      spaFallback = true
    } else {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const contentType = mime.get(extname(file)) ?? 'application/octet-stream'
    securityHeaders(response, contentType)
    response.setHeader('cache-control', file.endsWith('index.html') || file.endsWith('sw.js')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable')
    response.writeHead(200)
    createReadStream(file).pipe(response)
  } catch {
    if (spaFallback) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('SHE PWA is not built. Run: pnpm pwa:build')
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  }
}

const controlTarget = {
  label: 'SHE control plane',
  socketPath: controlSocketPath,
  tokenFile: controlTokenFile,
  rewritePath: path => path,
}
const brokerTarget = {
  label: 'SHE sandbox broker',
  socketPath: brokerSocketPath,
  tokenFile: brokerTokenFile,
  rewritePath: path => path.startsWith('/broker') ? path.slice('/broker'.length) || '/' : path,
}

const server = createServer((request, response) => {
  const pathname = (request.url ?? '').split('?', 1)[0]
  if (pathname.startsWith('/api/')) {
    void handleCompanionApi(request, response)
    return
  }
  if (pathname.startsWith('/broker/v1/')) {
    void proxyApi(request, response, brokerTarget)
    return
  }
  if (pathname.startsWith('/v1/')) {
    void proxyApi(request, response, controlTarget)
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }
  void serveStatic(request, response)
})

server.listen(port, host, () => {
  process.stdout.write(`she-pwa listening on http://${host}:${String(port)}\n`)
  process.stdout.write(`control-plane socket: ${controlSocketPath}\n`)
  process.stdout.write(`broker socket: ${brokerSocketPath}\n`)
  process.stdout.write(`serving: ${distDir}\n`)
  process.stdout.write(`allowed browser origins: ${[...allowedOrigins].join(', ')}\n`)
})

const shutdown = () => server.close(() => process.exit(0))
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
