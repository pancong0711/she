#!/usr/bin/env node
/**
 * Stable local SHE companion.
 *
 * Serves a static PWA build, proxies control-plane/broker APIs over local Unix
 * sockets, and runs allowlisted install/diagnostic jobs. It binds 127.0.0.1
 * only. This layer must not import SHE core/control/broker implementation code.
 */

import { createReadStream, existsSync } from 'node:fs'
import { access, mkdir, readFile, readlink, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { homedir, userInfo } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverAndPlan, scanLocalAgents } from './local-agents.mjs'
import { dockerGuidance, summarizePreflight } from './preflight.mjs'
import { authorizeWorkspace, listWorkspaceAuthorizations, removeWorkspaceAuthorization } from './workspaces.mjs'
import { compareVersions, validateCompanionManifest, validateCompanionManifestUrl } from './companion-update.mjs'
import { dockerInstallGuide, readOsRelease } from './docker-install.mjs'
import { autostartOptionsFromEnv, autostartStatus, disableAutostart, enableAutostart } from './autostart.mjs'
import { probeGatewayAdapter, readGatewayConfig, writeGatewayConfig } from './gateway.mjs'
import { terminateUnixSocketOwner } from './core-process.mjs'
import { SANDBOX_IMAGE_PRESETS, readSandboxPreferences, writeSandboxPreferences } from './sandbox-preferences.mjs'
import { defaultFeishu4dshPaths, inspectFeishu4dsh, validateFeishu4dshPackageSpec, validateFeishu4dshProfile } from './feishu4dsh.mjs'
import { inspectOpenCodeService, reconcileOpenCodeWorkerConfig } from './opencode-service.mjs'
import { sandboxAgentRecipeCatalog } from './sandbox-agent-recipes.mjs'
import { FeishuGatewayManager } from './feishu-gateway-manager.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const distDir = process.env.SHE_PWA_DIST?.trim()
  ? resolve(process.env.SHE_PWA_DIST.trim())
  : resolve(repoRoot, 'apps/pwa/dist')
const companionVersion = JSON.parse(await readFile(join(here, 'package.json'), 'utf8')).version
const sourceCheckout = existsSync(join(repoRoot, 'pnpm-workspace.yaml')) && existsSync(join(repoRoot, 'packages'))
const DEV_JOB_KINDS = new Set(['install', 'build', 'build-all', 'test'])
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
const stateHome = process.env.XDG_STATE_HOME?.trim() || join(homedir(), '.local', 'state')
const coreDbPath = process.env.SHE_DB_PATH?.trim() || join(stateHome, 'she', 'she.db')
const coreRoot = process.env.SHE_CORE_ROOT?.trim() || join(dataHome, 'she', 'core')
const workerConfigPath = process.env.SHE_WORKER_CONFIG_FILE?.trim() || join(configHome, 'she', 'worker.json')
const migrationRecordRoot = process.env.SHE_MIGRATION_RECORD_ROOT?.trim() || join(dataHome, 'she', 'migrations')
const migrationWorkspaceRoot = process.env.SHE_MIGRATION_WORKSPACE_ROOT?.trim() || join(dataHome, 'she', 'workspaces')
const workspaceRegistryPath = process.env.SHE_WORKSPACE_REGISTRY?.trim() || join(configHome, 'she', 'workspaces.json')
const gatewayConfigPath = process.env.SHE_GATEWAY_CONFIG_FILE?.trim() || join(configHome, 'she', 'gateway.json')
const sandboxPreferencesPath = process.env.SHE_SANDBOX_PREFERENCES_FILE?.trim() || join(configHome, 'she', 'sandbox.json')
const companionInstallRoot = process.env.SHE_COMPANION_ROOT?.trim() || undefined
const companionBinDir = process.env.SHE_BIN_DIR?.trim() || join(homedir(), '.local', 'bin')
const companionSupervised = process.env.SHE_COMPANION_SUPERVISED === '1'
const COMPANION_RESTART_EXIT_CODE = 75
const defaultCoreManifestUrl = process.env.SHE_CORE_MANIFEST_URL?.trim() || 'https://github.com/pancong0711/she/releases/download/v0.3.0-core.1/release-manifest.json'
const controlSocketPath = process.env.SHE_CONTROL_SOCKET?.trim() || join(runtimeHome, 'she', 'control.sock')
const controlTokenFile = process.env.SHE_TOKEN_FILE?.trim() || join(configHome, 'she', 'token')
const brokerSocketPath = process.env.SHE_BROKER_SOCKET?.trim() || join(runtimeHome, 'she', 'broker.sock')
const brokerTokenFile = process.env.SHE_BROKER_TOKEN_FILE?.trim() || join(configHome, 'she', 'broker-token')
const feishuGatewayEnvFile = process.env.SHE_FEISHU_ENV_FILE?.trim() || join(configHome, 'she', 'feishu.env')
const feishuGatewayEntry = process.env.SHE_FEISHU_GATEWAY_ENTRY?.trim() || join(here, '../feishu-gateway/dist/main.cjs')
const feishuGateway = new FeishuGatewayManager({
  envFile: feishuGatewayEnvFile,
  entry: feishuGatewayEntry,
  env: childEnv,
  controlSocket: controlSocketPath,
  tokenFile: controlTokenFile,
})
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
  ['agent-migrate', 'AI agent 容器化迁移'],
  ['feishu4dsh-install', '安装/更新 feishu4dsh dsh 插件'],
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
  if (job !== undefined) appendJobEvent(job, { type: 'system', text: `$ ${[command, ...args].join(' ')}` })
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
      if (job !== undefined) appendLog(job, 'stdout', text)
    })
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8')
      stderr.push(text)
      if (job !== undefined) appendLog(job, 'stderr', text)
    })
    child.on('error', error => {
      const message = error?.code === 'ENOENT'
        ? `command not found: ${command}`
        : `failed to start ${command}: ${error.message}`
      if (job !== undefined) appendJobEvent(job, { type: 'system', text: message })
      finish({ code: 127, ok: false, stdout: '', stderr: message })
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
  const add = (status, label, detail, options = {}) => {
    const check = {
      type: 'check',
      status,
      label,
      detail,
      requirement: options.requirement ?? 'recommended',
      ...(options.feature === undefined ? {} : { feature: options.feature }),
      ...(options.remediation === undefined ? {} : { remediation: options.remediation }),
    }
    checks.push(check)
    appendJobEvent(job, check)
  }
  const checkPath = async (label, path, options = {}) => {
    try {
      const info = await stat(path)
      const kind = info.isSocket() ? 'socket' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'path'
      add('ok', label, `${path} (${kind})`, options)
    } catch {
      add('warn', label, `missing: ${path}`, {
        ...options,
        ...(options.remediation === undefined ? { remediation: '启动对应的 SHE core 组件后重新检查。' } : {}),
      })
    }
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  add(
    uid === 0 ? 'fail' : 'ok',
    'user',
    uid === undefined ? 'uid unavailable on this platform' : uid === 0 ? 'SHE companion must not run as root' : `uid=${String(uid)}; no sudo/root execution`,
    { requirement: 'required', remediation: '使用普通用户重新运行 SHE companion；不要使用 sudo 或 root。' },
  )

  const nodeVersion = process.versions.node
  add(
    nodeVersionSupported(nodeVersion) ? 'ok' : 'fail',
    'Node.js',
    `v${nodeVersion}; required ^22.19.0 || >=24.0.0`,
    { requirement: 'required', remediation: '安装 Node.js ^22.19.0 或 >=24.0.0 后重启 companion。' },
  )

  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const pnpmResult = await captureCommand(job, pnpmCommand, ['--version'])
  add(
    pnpmResult.ok && pnpmVersionSupported(pnpmResult.stdout) ? 'ok' : 'fail',
    'pnpm',
    pnpmResult.ok ? `${pnpmResult.stdout}; required >=11.22.0` : (pnpmResult.stderr || 'not found'),
    { requirement: 'required', remediation: '点击“用户级环境准备（不请求 root）”，或按文档安装 pnpm >=11.22.0。' },
  )

  const gitResult = await captureCommand(job, 'git', ['--version'])
  add(
    gitResult.ok ? 'ok' : 'warn',
    'git',
    gitResult.ok ? gitResult.stdout : (gitResult.stderr || 'not installed; needed for clone/update'),
    { requirement: 'recommended', remediation: '如需从源码克隆或更新仓库，请由你本人安装 git。' },
  )

  // A sandbox runtime is optional for companion/core/worker basics but
  // required for broker containers, Sandboxes and Agent Migration.
  const dockerResult = await captureCommand(job, 'docker', ['version', '--format', '{{.Server.Version}}'])
  let dockerSecurity
  if (dockerResult.ok) {
    dockerSecurity = await captureCommand(job, 'docker', ['info', '--format', '{{json .SecurityOptions}}'])
    if (dockerSecurity.ok && dockerSecurity.stdout.includes('rootless')) {
      add('ok', 'Docker sandbox runtime', `rootless Docker ${dockerResult.stdout}`, {
        requirement: 'sandbox',
        feature: 'sandbox',
      })
    } else {
      add(
        'warn',
        'Docker sandbox runtime',
        `Docker ${dockerResult.stdout} 可访问，但未检测到 rootless；通过 docker 组访问可能是 root-equivalent。`,
        {
          requirement: 'sandbox',
          feature: 'sandbox',
          remediation: '如需要更强隔离，由你本人改用 rootless Docker；SHE 不会伪装它是 rootless。',
        },
      )
    }
  } else {
    const guidance = dockerGuidance(dockerResult)
    add('warn', 'Docker sandbox runtime', guidance.detail, {
      requirement: 'sandbox',
      feature: 'sandbox',
      remediation: guidance.remediation,
    })
  }

  await checkPath('control-plane build', join(repoRoot, 'apps/control-plane/dist/main.js'), {
    requirement: 'development',
    feature: 'control-plane',
    remediation: '开发态运行 `pnpm build`；安装版应通过 Core 更新安装 core bundle。',
  })
  await checkPath('broker build', join(repoRoot, 'apps/broker/dist/main.js'), {
    requirement: 'development',
    feature: 'broker',
    remediation: '开发态运行 `pnpm build`；安装版应通过 Core 更新安装 core bundle。',
  })
  await checkPath('PWA build', join(distDir, 'index.html'), {
    requirement: 'development',
    feature: 'pwa',
    remediation: '开发态运行 `pnpm pwa:build`。',
  })
  await checkPath('control socket', controlSocketPath, {
    requirement: 'runtime',
    feature: 'control-plane',
    remediation: '在 Install & Doctor 的 Core 版本与更新中安装/启动 core。',
  })
  await checkPath('broker socket', brokerSocketPath, {
    requirement: 'runtime',
    feature: 'broker',
    remediation: '在 Install & Doctor 的 Core 版本与更新中安装/启动 core（broker 随 core 启动）。',
  })

  if (process.platform === 'linux') {
    const userSystemd = await captureCommand(job, 'systemctl', ['--user', 'show-environment'])
    add(
      userSystemd.ok ? 'ok' : 'warn',
      'systemd --user',
      userSystemd.ok ? 'user systemd manager is available' : (userSystemd.stderr || 'systemctl --user unavailable'),
      {
        requirement: 'persistence',
        feature: 'persistence',
        remediation: '无桌面/远程部署需要可用的 user systemd；请由你本人检查登录会话和 systemd 配置。',
      },
    )
    const username = userInfo().username
    const linger = await captureCommand(job, 'loginctl', ['show-user', username, '-p', 'Linger'])
    const lingerEnabled = linger.ok && /(?:^|\n)Linger=yes(?:\n|$)/.test(linger.stdout)
    add(
      lingerEnabled ? 'ok' : 'warn',
      'headless persistence (linger)',
      lingerEnabled ? `Linger=yes for ${username}` : (linger.ok ? linger.stdout.trim() || 'Linger=no' : (linger.stderr || 'loginctl unavailable')),
      {
        requirement: 'persistence',
        feature: 'persistence',
        remediation: `由你本人执行 sudo loginctl enable-linger "${username}"；否则退出 SSH/最后一个登录会话后，rootless Docker 和用户级 companion 服务可能停止。`,
      },
    )
  }

  try {
    const auto = await autostartStatus(autostartOptionsFromEnv())
    add(
      auto.enabled ? 'ok' : 'warn',
      'Companion login autostart',
      `${auto.mode}${auto.path === null ? '' : `: ${auto.path}`}`,
      {
        requirement: 'persistence',
        feature: 'persistence',
        remediation: 'Settings → Companion 版本与生命周期 → 启用登录自启动。',
      },
    )
  } catch (error) {
    add('warn', 'Companion login autostart', error.message, {
      requirement: 'persistence',
      feature: 'persistence',
      remediation: 'Settings → Companion 版本与生命周期 → 启用登录自启动。',
    })
  }

  const controlProbe = await probeSocket(controlSocketPath, controlTokenFile)
  if (controlProbe.reachable) {
    try {
      const agent = await requestControlJson('GET', '/v1/agents', undefined)
      add(
        agent?.health?.ok ? 'ok' : 'warn',
        'OpenCode agent health',
        agent?.health?.ok ? `OpenCode ${agent.health.version ?? 'healthy'}` : (agent?.health?.detail ?? 'agent health unavailable'),
        {
          requirement: 'agent',
          feature: 'agent',
          remediation: '启动 OpenCode 服务，并在 Settings 中检查 URL、用户名、凭据文件路径和 worker 配置。',
        },
      )
    } catch (error) {
      add('warn', 'OpenCode agent health', error.message, {
        requirement: 'agent',
        feature: 'agent',
        remediation: '检查 core/control-plane 与 OpenCode 服务。',
      })
    }
    try {
      const gateway = await gatewayStatus()
      if (gateway.config.enabled) {
        add(
          gateway.adapter.reachable ? 'ok' : 'warn',
          'feishu4dsh adapter health',
          gateway.adapter.reachable ? `HTTP ${String(gateway.adapter.httpStatus ?? 200)}` : (gateway.adapter.detail ?? 'unreachable'),
          {
            requirement: 'gateway',
            feature: 'gateway',
            remediation: '确认 feishu4dsh 已启动，并在 Gateway 页面配置 loopback health URL。',
          },
        )
      }
    } catch (error) {
      add('warn', 'feishu4dsh adapter health', error.message, {
        requirement: 'gateway',
        feature: 'gateway',
        remediation: '打开 Gateway 页面检查 adapter 配置。',
      })
    }
  }

  const outcome = summarizePreflight(checks, dockerResult.ok)
  const { failures, warnings, ok, sandboxReady, summary } = outcome
  lastPreflight = { at: Date.now(), ok, sandboxReady, checks, warnings, summary }
  if (ok) {
    appendJobEvent(job, { type: 'system', text: 'preflight passed: required toolchain is ready.' })
    if (warnings.length > 0) {
      appendJobEvent(job, { type: 'system', text: `preflight completed with ${String(warnings.length)} warning(s); optional/full capabilities may be unavailable.` })
      for (const warning of warnings) {
        appendJobEvent(job, {
          type: 'system',
          text: `${warning.label} 不可用或有风险：${warning.detail}${warning.remediation === undefined ? '' : ` 修复：${warning.remediation}`}`,
        })
      }
    }
  } else {
    appendJobEvent(job, { type: 'system', text: 'preflight failed; fix required checks before continuing.' })
    for (const failure of failures) {
      appendJobEvent(job, {
        type: 'system',
        text: `${failure.label} 不满足要求：${failure.detail}${failure.remediation === undefined ? '' : ` 修复：${failure.remediation}`}`,
      })
    }
  }
  return { ok, sandboxReady, checks, warnings, failures, summary }
}


function expandHome(path) {
  if (path === '~') return homedir()
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

function defaultWorkerConfig(openCodeService) {
  const providerId = process.env.SHE_AGENT_MODEL_PROVIDER?.trim() || ''
  const modelId = process.env.SHE_AGENT_MODEL_ID?.trim() || ''
  const variant = process.env.SHE_AGENT_MODEL_VARIANT?.trim() || ''
  return {
    schema: 1,
    enabled: process.env.SHE_WORKER_ENABLED === '1',
    opencodeUrl: process.env.SHE_OPENCODE_URL?.trim() || openCodeService?.url || 'http://127.0.0.1:49375',
    opencodeUsername: process.env.SHE_OPENCODE_USERNAME?.trim() || openCodeService?.username || 'opencode',
    opencodePasswordFile: process.env.SHE_OPENCODE_PASSWORD_FILE?.trim() || openCodeService?.credentialFile || expandHome('~/.config/opencode/service.json'),
    workspacePath: process.env.SHE_WORKSPACE_PATH?.trim() || join(dataHome, 'she', 'workspaces', 'default'),
    pollIntervalMs: Number(process.env.SHE_WORKER_POLL_MS ?? 1_000),
    leaseTtlMs: Number(process.env.SHE_WORKER_LEASE_TTL_MS ?? 300_000),
    ...(providerId !== '' && modelId !== '' ? { model: { providerId, modelId, ...(variant === '' ? {} : { variant }) } } : {}),
  }
}

async function readWorkerConfig(openCodeService) {
  const detectedOpenCode = openCodeService ?? await inspectOpenCodeService().catch(() => undefined)
  const defaults = defaultWorkerConfig(detectedOpenCode)
  try {
    const parsed = JSON.parse(await readFile(workerConfigPath, 'utf8'))
    if (parsed?.schema !== 1) throw new Error('invalid worker config schema')
    const merged = {
      ...defaults,
      ...parsed,
      pollIntervalMs: Number(parsed.pollIntervalMs ?? defaults.pollIntervalMs),
      leaseTtlMs: Number(parsed.leaseTtlMs ?? defaults.leaseTtlMs),
    }
    // Old versions filled the Settings form with a hard-coded URL/config path.
    // If OpenCode's --service state file advertises a different loopback URL
    // and the user never changed those two legacy defaults, follow the live
    // service instead of sending every task to a stale port.
    const legacyConfigFile = resolve(expandHome('~/.config/opencode/service.json'))
    return reconcileOpenCodeWorkerConfig(merged, detectedOpenCode, legacyConfigFile)
  } catch (error) {
    if (error?.code === 'ENOENT') return defaults
    throw error
  }
}

function validateWorkerConfig(input, defaults = defaultWorkerConfig()) {
  const workspacePath = expandHome(String(input.workspacePath ?? defaults.workspacePath).trim())
  const passwordFile = expandHome(String(input.opencodePasswordFile ?? defaults.opencodePasswordFile).trim())
  if (!resolve(workspacePath).startsWith('/')) throw new Error('workspacePath must be absolute')
  if (!resolve(passwordFile).startsWith('/')) throw new Error('opencodePasswordFile must be absolute')
  const opencodeUrl = String(input.opencodeUrl ?? defaults.opencodeUrl).trim()
  if (!/^https?:\/\//.test(opencodeUrl)) throw new Error('opencodeUrl must be http(s)')
  const pollIntervalMs = Number(input.pollIntervalMs ?? defaults.pollIntervalMs)
  const leaseTtlMs = Number(input.leaseTtlMs ?? defaults.leaseTtlMs)
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100) throw new Error('pollIntervalMs must be >= 100')
  if (!Number.isInteger(leaseTtlMs) || leaseTtlMs < 1_000) throw new Error('leaseTtlMs must be >= 1000')
  const modelInput = input.model
  const model = modelInput !== undefined && modelInput !== null
    ? {
        providerId: String(modelInput.providerId ?? '').trim(),
        modelId: String(modelInput.modelId ?? '').trim(),
        ...(String(modelInput.variant ?? '').trim() === '' ? {} : { variant: String(modelInput.variant).trim() }),
      }
    : undefined
  if (model !== undefined && (model.providerId === '' || model.modelId === '')) throw new Error('model providerId/modelId are required')
  return {
    schema: 1,
    enabled: input.enabled === true,
    opencodeUrl: opencodeUrl.replace(/\/+$/, ''),
    opencodeUsername: String(input.opencodeUsername ?? defaults.opencodeUsername).trim() || 'opencode',
    opencodePasswordFile: resolve(passwordFile),
    workspacePath: resolve(workspacePath),
    pollIntervalMs,
    leaseTtlMs,
    ...(model === undefined ? {} : { model }),
  }
}

async function saveWorkerConfig(input) {
  const openCodeService = await inspectOpenCodeService().catch(() => undefined)
  const validated = validateWorkerConfig(input, defaultWorkerConfig(openCodeService))
  const legacyConfigFile = resolve(expandHome('~/.config/opencode/service.json'))
  const config = reconcileOpenCodeWorkerConfig(validated, openCodeService, legacyConfigFile)
  await mkdir(dirname(workerConfigPath), { recursive: true, mode: 0o700 })
  await writeFile(workerConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  return config
}

function workerEnvFromConfig(config) {
  return {
    SHE_WORKER_ENABLED: config.enabled ? '1' : '0',
    SHE_OPENCODE_URL: config.opencodeUrl,
    SHE_OPENCODE_USERNAME: config.opencodeUsername,
    SHE_OPENCODE_PASSWORD_FILE: config.opencodePasswordFile,
    SHE_WORKSPACE_PATH: config.workspacePath,
    SHE_WORKER_POLL_MS: String(config.pollIntervalMs),
    SHE_WORKER_LEASE_TTL_MS: String(config.leaseTtlMs),
    ...(config.model === undefined ? {} : {
      SHE_AGENT_MODEL_PROVIDER: config.model.providerId,
      SHE_AGENT_MODEL_ID: config.model.modelId,
      ...(config.model.variant === undefined ? {} : { SHE_AGENT_MODEL_VARIANT: config.model.variant }),
    }),
  }
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
      external: coreChild === null && controlPlane.reachable,
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

async function packageCatalog() {
  const osRelease = await readOsRelease()
  const current = await readCurrentCoreVersion()
  const previous = await readPreviousCoreVersion()
  const platform = process.platform
  const isWindows = platform === 'win32'
  const isMac = platform === 'darwin'
  const pnpmCommand = isWindows ? 'pnpm.cmd' : 'pnpm'
  const shellCommand = isWindows ? 'powershell' : 'bash'
  const shellArgs = isWindows ? ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'] : ['--version']
  const [pnpmResult, gitResult, dockerVersion, dockerSecurity, shellResult, curlResult, tarResult, sha256sumResult, shasumResult, opencodeResult, npmResult, corepackResult] = await Promise.all([
    captureCommand(undefined, pnpmCommand, ['--version']),
    captureCommand(undefined, 'git', ['--version']),
    captureCommand(undefined, 'docker', ['version', '--format', '{{.Server.Version}}']),
    captureCommand(undefined, 'docker', ['info', '--format', '{{json .SecurityOptions}}']),
    captureCommand(undefined, shellCommand, shellArgs),
    captureCommand(undefined, 'curl', ['--version']),
    captureCommand(undefined, 'tar', ['--version']),
    captureCommand(undefined, 'sha256sum', ['--version']),
    captureCommand(undefined, 'shasum', ['-a', '256', '/dev/null']),
    captureCommand(undefined, 'opencode', ['--version']),
    captureCommand(undefined, 'npm', ['--version']),
    captureCommand(undefined, 'corepack', ['--version']),
  ])
  const dockerRootless = dockerVersion.ok && dockerSecurity.ok && dockerSecurity.stdout.includes('rootless')
  const nodeReady = nodeVersionSupported(process.versions.node)
  const pnpmReady = pnpmResult.ok && pnpmVersionSupported(pnpmResult.stdout)
  const checksumReady = sha256sumResult.ok || shasumResult.ok || (isWindows && shellResult.ok)
  const bootstrapHelperReady = npmResult.ok || corepackResult.ok
  const install = (mode, title, commands, note, url) => ({
    mode,
    title,
    commands,
    ...(url === undefined ? {} : { url }),
    note,
  })
  const dockerGuide = dockerInstallGuide(platform, osRelease)
  const dockerInstall = {
    ...install(
      'instructions-only',
      dockerGuide.title,
      dockerGuide.commands,
      dockerGuide.note,
      dockerGuide.url,
    ),
    steps: dockerGuide.steps,
    ...(dockerGuide.alternatives === undefined ? {} : { alternatives: dockerGuide.alternatives }),
  }

  return [
    {
      id: 'she-companion',
      name: 'SHE Companion',
      kind: 'component',
      installedVersion: companionVersion,
      state: 'installed',
      requirement: 'required',
      requiredFor: ['PWA host', '本地 API', 'core 启停'],
      management: 'launcher',
      note: '稳定层。升级需要运行 checksum-verified companion launcher；PWA 不会在运行中替换 companion。',
      install: install(
        'managed',
        '使用 companion launcher',
        ['# 从 PWA 下载 start.sh / start.command / start.bat 后运行一次', '# 或按 Release 页面说明使用 install-companion.sh'],
        'launcher 会校验 manifest 与 SHA-256，并安装到当前用户目录。',
        'https://github.com/pancong0711/she/releases',
      ),
    },
    {
      id: 'she-core',
      name: 'SHE Core (control-plane + broker)',
      kind: 'core',
      installedVersion: current?.version ?? null,
      previousVersion: previous?.version ?? null,
      state: current === undefined ? 'not-installed' : 'installed',
      requirement: 'required',
      requiredFor: ['Tasks', 'Chat', 'Control plane', 'sandbox broker'],
      management: 'core-update',
      manifestUrl: defaultCoreManifestUrl,
      note: '首次安装必须完成 Core 更新；之后支持 staging、SHA-256 校验、health check 和自动回滚。',
      install: install(
        'managed',
        '通过 Core 更新安装/启动',
        ['# 打开 Install & Doctor → Core 版本与更新', '# 点击“检查更新”，首次会从“未安装”安装到当前 Release 版本'],
        'core 安装后 control-plane 与 broker 由 companion 监管启动；不执行 sudo。',
        defaultCoreManifestUrl,
      ),
    },
    {
      id: 'node-runtime',
      name: 'Node.js runtime',
      kind: 'runtime',
      installedVersion: process.versions.node,
      state: nodeReady ? 'ready' : 'unsupported',
      requirement: 'required',
      requiredFor: ['companion', 'core', 'worker'],
      management: 'instructions-only',
      note: '要求 ^22.19.0 || >=24.0.0。SHE 不自动安装 Node，也不请求 root。',
      install: install(
        'instructions-only',
        isMac ? '使用官方安装包、nvm/fnm 或 Homebrew' : isWindows ? '使用官方安装包或 winget' : '使用官方安装包、nvm/fnm 或发行版包管理器',
        isMac
          ? ['# 任选一种，由你本人执行', 'brew install node@22', '# 或 https://nodejs.org/en/download', 'node --version']
          : isWindows
            ? ['# 由你本人执行', 'winget install OpenJS.NodeJS.LTS', 'node --version']
            : ['# 任选一种，由你本人执行', 'sudo apt install nodejs npm   # Debian/Ubuntu 示例', '# 或使用 nvm/fnm/官方二进制', 'node --version'],
        '建议使用 Node 24+ 或 22.19+；若使用系统包管理器，请先确认版本满足要求。',
        'https://nodejs.org/en/download',
      ),
    },
    {
      id: 'pnpm-runtime',
      name: 'pnpm',
      kind: 'runtime',
      installedVersion: pnpmResult.ok ? pnpmResult.stdout : null,
      state: pnpmReady ? 'ready' : 'missing',
      requirement: 'required',
      requiredFor: ['源码构建', '依赖安装', '开发/调试'],
      management: 'bootstrap',
      note: '要求 >=11.22.0。可通过“用户级环境准备”安装到当前用户目录，不需要 sudo。',
      install: install(
        'user-local',
        '用户级准备 pnpm',
        ['# 推荐直接点击下方“用户级准备 pnpm”', 'corepack prepare pnpm@11.22.0 --activate', '# 或 npm install --global --prefix "$HOME/.local" pnpm@11.22.0', 'pnpm --version'],
        '该操作只写入当前用户目录；SHE 不执行 sudo。',
        'https://pnpm.io/installation',
      ),
    },
    {
      id: 'git-runtime',
      name: 'git',
      kind: 'tool',
      installedVersion: gitResult.ok ? gitResult.stdout : null,
      state: gitResult.ok ? 'ready' : 'missing',
      requirement: 'recommended',
      requiredFor: ['源码克隆', '开发/更新'],
      management: 'instructions-only',
      note: '安装版 companion/core 可以不需要 git；从源码运行或更新仓库时需要。',
      install: install(
        'instructions-only',
        isMac ? '安装 Xcode Command Line Tools 或 git' : isWindows ? '安装 Git for Windows' : '使用发行版包管理器安装 git',
        isMac
          ? ['xcode-select --install', '# 或 brew install git', 'git --version']
          : isWindows
            ? ['winget install --id Git.Git -e', 'git --version']
            : ['sudo apt install git   # Debian/Ubuntu 示例', 'git --version'],
        'SHE 只显示安装方法，由用户本人执行。',
        isWindows ? 'https://git-scm.com/download/win' : 'https://git-scm.com/downloads',
      ),
    },
    {
      id: 'docker-runtime',
      name: 'Docker / sandbox runtime',
      kind: 'runtime',
      installedVersion: dockerVersion.ok ? dockerVersion.stdout : null,
      state: dockerVersion.ok ? (dockerRootless ? 'ready-rootless' : 'ready-root-equivalent-risk') : 'missing',
      requirement: 'sandbox',
      requiredFor: ['Sandbox', 'broker 容器', 'Agent Migration'],
      management: 'instructions-only',
      note: dockerRootless
        ? '已检测到 rootless Docker。'
        : dockerVersion.ok
          ? 'Docker 可访问，但未检测到 rootless；docker 组权限可能是 root-equivalent。'
          : 'Docker 不可用。基础 companion/core/Tasks 不受影响，但 Sandbox 和 Agent Migration 不可用。',
      install: dockerInstall,
    },
    {
      id: 'shell-runtime',
      name: isWindows ? 'PowerShell' : 'bash',
      kind: 'tool',
      installedVersion: shellResult.ok ? (isWindows ? shellResult.stdout : shellResult.stdout.split('\n')[0]) : null,
      state: shellResult.ok ? 'ready' : 'missing',
      requirement: 'required',
      requiredFor: isWindows ? ['PowerShell launcher', 'Windows 安装脚本'] : ['run-core.sh', '安装/更新脚本'],
      management: 'instructions-only',
      note: isWindows ? 'Windows 安装脚本需要 PowerShell。' : 'POSIX 下 core 启动和安装/更新脚本需要 bash。',
      install: install(
        'instructions-only',
        isWindows ? '启用 PowerShell' : '安装 bash',
        isWindows
          ? ['# Windows 通常已内置 PowerShell；打开 PowerShell 验证', '$PSVersionTable.PSVersion']
          : isMac
            ? ['# macOS 通常自带 bash；如需新版', 'brew install bash', 'bash --version']
            : ['sudo apt install bash   # Debian/Ubuntu 示例', 'bash --version'],
        'SHE 只显示安装方法，由用户本人执行。',
        isWindows ? 'https://learn.microsoft.com/powershell/' : 'https://www.gnu.org/software/bash/',
      ),
    },
    {
      id: 'curl-runtime',
      name: 'curl',
      kind: 'tool',
      installedVersion: curlResult.ok ? curlResult.stdout.split('\n')[0] : null,
      state: curlResult.ok ? 'ready' : 'missing',
      requirement: 'required',
      requiredFor: ['start.sh 下载', 'Release 安装器'],
      management: 'instructions-only',
      note: '一键 launcher 和安装器需要 curl 下载 manifest/bundle。',
      install: install(
        'instructions-only',
        '安装 curl',
        isMac
          ? ['# macOS 通常自带 curl', 'curl --version']
          : isWindows
            ? ['# Windows 10+ 通常自带 curl；或', 'winget install curl.curl', 'curl --version']
            : ['sudo apt install curl   # Debian/Ubuntu 示例', 'curl --version'],
        'SHE 只显示安装方法，由用户本人执行。',
        'https://curl.se/download.html',
      ),
    },
    {
      id: 'tar-runtime',
      name: 'tar',
      kind: 'tool',
      installedVersion: tarResult.ok ? tarResult.stdout.split('\n')[0] : null,
      state: tarResult.ok ? 'ready' : 'missing',
      requirement: 'required',
      requiredFor: ['bundle 解压', 'core/companion 安装'],
      management: 'instructions-only',
      note: '安装器和 core 更新会解压 tar.gz bundle。',
      install: install(
        'instructions-only',
        '安装 tar',
        isMac
          ? ['# macOS 通常自带 tar', 'tar --version']
          : isWindows
            ? ['# Windows 10+ 通常自带 tar', 'tar --version']
            : ['sudo apt install tar   # Debian/Ubuntu 示例', 'tar --version'],
        'SHE 只显示安装方法，由用户本人执行。',
        'https://www.gnu.org/software/tar/',
      ),
    },
    {
      id: 'checksum-runtime',
      name: isWindows ? 'PowerShell Get-FileHash' : 'SHA-256 工具',
      kind: 'tool',
      installedVersion: checksumReady ? (sha256sumResult.ok ? 'sha256sum' : shasumResult.ok ? 'shasum' : 'Get-FileHash') : null,
      state: checksumReady ? 'ready' : 'missing',
      requirement: 'required',
      requiredFor: ['bundle 完整性校验'],
      management: 'instructions-only',
      note: 'launcher、companion 安装器和 core 更新使用 SHA-256 校验下载内容。',
      install: install(
        'instructions-only',
        isWindows ? '使用 PowerShell Get-FileHash' : '安装 coreutils / shasum',
        isWindows
          ? ['# Windows PowerShell 内置 Get-FileHash', 'Get-FileHash .\bundle.tar.gz -Algorithm SHA256']
          : isMac
            ? ['# macOS 通常自带 shasum', 'shasum -a 256 bundle.tar.gz']
            : ['sudo apt install coreutils   # Debian/Ubuntu 示例', 'sha256sum bundle.tar.gz'],
        'SHE 只显示安装方法，由用户本人执行。',
        isWindows ? 'https://learn.microsoft.com/powershell/module/microsoft.powershell.utility/get-filehash' : 'https://www.gnu.org/software/coreutils/',
      ),
    },
    {
      id: 'node-bootstrap-tools',
      name: 'npm / corepack',
      kind: 'tool',
      installedVersion: npmResult.ok ? `npm ${npmResult.stdout}` : corepackResult.ok ? `corepack ${corepackResult.stdout}` : null,
      state: bootstrapHelperReady ? 'ready' : 'missing',
      requirement: 'optional',
      requiredFor: ['pnpm 用户级安装的备选路径'],
      management: 'instructions-only',
      note: '通常随 Node.js 提供。缺少时可能无法在用户目录自动安装 pnpm。',
      install: install(
        'instructions-only',
        '随 Node.js 安装',
        ['# npm/corepack 通常随 Node.js 一起安装', 'node --version', 'npm --version', 'corepack --version'],
        '如果二者都缺失，请重新安装 Node.js 或手动安装 pnpm。',
        'https://nodejs.org/en/download',
      ),
    },
    {
      id: 'opencode-runtime',
      name: 'OpenCode agent runtime',
      kind: 'agent',
      installedVersion: opencodeResult.ok ? opencodeResult.stdout : null,
      state: opencodeResult.ok ? 'ready' : 'unknown',
      requirement: 'optional',
      requiredFor: ['Agent Worker', 'PWA Chat 实际执行'],
      management: 'external',
      note: opencodeResult.ok
        ? '检测到 opencode CLI。仍需在 Settings 配置 OpenCode URL、凭据文件路径和 workspace。'
        : '未在 PATH 中检测到 opencode CLI。若你使用远程或已有 OpenCode 服务，只需在 Settings 配置 URL；SHE 不自动安装 agent runtime。',
      install: install(
        'external',
        '按 OpenCode 官方文档安装并启动服务',
        ['# 由你本人安装/启动 OpenCode，然后在 Settings 配置：', '# SHE_OPENCODE_URL / username / password file / workspace', 'opencode --version'],
        'OpenCode 是外部 agent runtime，凭据只保存文件路径，不保存内容。',
        'https://opencode.ai/docs/',
      ),
    },
  ]
}


function scheduleCompanionExit(code, delayMs = 350) {
  setTimeout(() => process.exit(code), delayMs).unref()
}

async function checkCompanionUpdate(manifestUrl) {
  const validatedUrl = validateCompanionManifestUrl(manifestUrl)
  const manifest = validateCompanionManifest(await readManifest(validatedUrl))
  const comparison = compareVersions(manifest.version, companionVersion)
  if (comparison === undefined) throw new Error('cannot compare companion versions')
  return {
    current: companionVersion,
    available: manifest.version,
    needsUpdate: comparison > 0,
    manifest,
  }
}

async function downloadCompanionBundle(manifestUrl, manifest) {
  const file = basename(String(manifest.bundle.file))
  const url = new URL(file, manifestUrl)
  let bytes
  if (url.protocol === 'file:') {
    bytes = await readFile(url)
  } else {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`companion bundle HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== String(manifest.bundle.sha256).toLowerCase()) {
    throw new Error(`companion bundle SHA-256 mismatch: expected ${String(manifest.bundle.sha256)} got ${actual}`)
  }
  if (companionInstallRoot === undefined) throw new Error('companion install root is unknown')
  const staging = join(companionInstallRoot, 'staging')
  await mkdir(staging, { recursive: true, mode: 0o700 })
  const target = join(staging, file)
  await writeFile(target, bytes, { mode: 0o600 })
  return { path: target, sha256: actual, bytes: bytes.byteLength }
}

async function applyCompanionUpdate(manifestUrl) {
  if (!companionSupervised || companionInstallRoot === undefined) {
    throw new Error('companion is not running under the launcher supervisor; restart/update from the page is unavailable')
  }
  if (process.platform === 'win32') {
    throw new Error('page-driven companion update is currently available on Linux/macOS only; use start.ps1 on Windows')
  }
  const checked = await checkCompanionUpdate(manifestUrl)
  if (!checked.needsUpdate) throw new Error(`companion is already ${companionVersion}`)
  const previousTarget = await readlink(join(companionInstallRoot, 'current')).catch(() => undefined)
  if (previousTarget === undefined) throw new Error('cannot resolve companion current version')
  const download = await downloadCompanionBundle(manifestUrl, checked.manifest)
  const installScript = join(repoRoot, 'scripts/install-companion.sh')
  const install = await captureCommand(undefined, 'bash', [
    installScript,
    download.path,
    '--sha256', download.sha256,
    '--install-root', companionInstallRoot,
    '--bin-dir', companionBinDir,
  ])
  if (!install.ok) throw new Error(`companion installer failed: ${install.stderr || install.stdout || 'unknown error'}`)
  await writeFile(join(companionInstallRoot, 'update-pending.json'), `${JSON.stringify({
    schema: 1,
    from: companionVersion,
    to: checked.manifest.version,
    previousTarget,
    bundleSha256: download.sha256,
    createdAt: Date.now(),
  }, null, 2)}\n`, { mode: 0o600 })
  return { from: companionVersion, to: checked.manifest.version, bundleSha256: download.sha256, restarting: true }
}

async function sandboxPreferencesStatus() {
  const config = await readSandboxPreferences(sandboxPreferencesPath)
  const imagesResult = await captureCommand(undefined, 'docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'])
  return {
    path: sandboxPreferencesPath,
    config,
    catalog: SANDBOX_IMAGE_PRESETS,
    localImages: imagesResult.ok ? imagesResult.stdout.split('\n').filter(Boolean).sort() : [],
  }
}

async function gatewayStatus() {
  const config = await readGatewayConfig(gatewayConfigPath)
  const control = await probeSocket(controlSocketPath, controlTokenFile)
  const adapter = config.enabled
    ? await probeGatewayAdapter(config.adapterHealthUrl)
    : { configured: config.adapterHealthUrl !== '', reachable: false, detail: 'gateway adapter disabled' }
  return {
    schema: 1,
    checkedAt: Date.now(),
    config,
    controlPlane: control,
    adapter,
    secretBoundary: {
      owner: 'feishu4dsh',
      sheReadsSecrets: false,
      note: '飞书 app secret、verification token、encrypt key 和 tenant token 必须留在 feishu4dsh；SHE 只接收 gateway.v1 事件/命令。',
    },
  }
}

async function platformStatus() {
  const platform = process.platform
  const osRelease = await readOsRelease()
  const dockerGuide = dockerInstallGuide(platform, osRelease)
  const [dockerVersion, dockerSecurity] = await Promise.all([
    captureCommand(undefined, 'docker', ['version', '--format', '{{.Server.Version}}']),
    captureCommand(undefined, 'docker', ['info', '--format', '{{json .SecurityOptions}}']),
  ])
  const dockerAvailable = dockerVersion.ok
  const dockerRootless = dockerAvailable && dockerSecurity.ok && dockerSecurity.stdout.includes('rootless')
  let wsl = false
  if (platform === 'linux') {
    try {
      const procVersion = await readFile('/proc/version', 'utf8')
      wsl = /microsoft|wsl/i.test(procVersion)
    } catch {}
  }
  const verified = 'verified'
  const implementedUnverified = 'implemented-unverified'
  const designOnly = 'design-only'
  return {
    schema: 1,
    checkedAt: Date.now(),
    runtime: {
      platform,
      arch: process.arch,
      release: process.release?.name ?? 'node',
      node: process.versions.node,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      home: homedir(),
      shell: platform === 'win32' ? 'powershell' : 'bash',
      wsl,
      pathSeparator: platform === 'win32' ? '\\' : '/',
    },
    docker: {
      available: dockerAvailable,
      mode: !dockerAvailable ? 'unavailable' : dockerRootless ? 'rootless' : 'root-equivalent-risk',
      ...(dockerVersion.ok ? { version: dockerVersion.stdout } : {}),
      install: dockerGuide,
    },
    capabilities: {
      pwa: true,
      companion: true,
      coreSupervisor: true,
      unixSocket: platform !== 'win32',
      sandboxBroker: dockerAvailable,
      agentMigration: dockerAvailable,
      rootlessDocker: dockerRootless,
      nativeWindowsSocket: false,
    },
    supportMatrix: [
      { feature: 'PWA / Companion', linux: verified, macos: implementedUnverified, windows: implementedUnverified },
      { feature: 'Core install / update / rollback', linux: verified, macos: implementedUnverified, windows: implementedUnverified },
      { feature: 'OpenCode worker / Chat', linux: verified, macos: implementedUnverified, windows: implementedUnverified },
      { feature: 'Sandbox broker / Docker', linux: verified, macos: implementedUnverified, windows: designOnly },
      { feature: 'Agent Migration host mounts', linux: implementedUnverified, macos: designOnly, windows: designOnly },
      { feature: 'Unix-socket control plane', linux: verified, macos: implementedUnverified, windows: 'unsupported' },
    ],
    notes: [
      'SHE never executes sudo and never requests root.',
      'Docker access through the docker group may be root-equivalent.',
      'Windows/macOS entries are explicit about verification status rather than being presented as production-ready.',
      ...(wsl ? ['WSL detected; Windows-native companion/socket behavior is still not verified.'] : []),
    ],
  }
}

async function startCore(job) {
  if (coreChild !== null) return { alreadyRunning: true, external: false }
  const existing = await probeSocket(controlSocketPath, controlTokenFile)
  if (existing.reachable) return { alreadyRunning: true, external: true }
  const entry = process.platform === 'win32'
    ? join(coreRoot, 'current', 'run-core.cmd')
    : join(coreRoot, 'current', 'run-core.sh')
  await access(entry)
  coreLastError = null
  coreStartedAt = Date.now()
  const command = process.platform === 'win32' ? 'cmd' : 'bash'
  const args = process.platform === 'win32' ? ['/c', entry] : [entry]
  const workerConfig = await readWorkerConfig()
  await mkdir(dirname(coreDbPath), { recursive: true, mode: 0o700 }).catch(() => undefined)
  if (job !== undefined) appendJobEvent(job, { type: 'system', text: `starting core: ${entry}` })
  const child = spawn(command, args, {
    cwd: join(coreRoot, 'current'),
    env: { ...childEnv, ...workerEnvFromConfig(workerConfig) },
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
  if (child === null) {
    const existing = await probeSocket(controlSocketPath, controlTokenFile)
    if (!existing.reachable) return { stopped: false, external: false }
    if (job !== undefined) appendJobEvent(job, { type: 'system', text: 'stopping external core process via control-plane admin shutdown' })
    let adminShutdownError
    try {
      await requestControlJson('POST', '/v1/admin/shutdown', {})
    } catch (error) {
      adminShutdownError = error
      if (job !== undefined) appendJobEvent(job, { type: 'system', text: `admin shutdown unavailable: ${error.message}; trying socket-owner recovery` })
    }
    let stopped = adminShutdownError === undefined ? await waitForControlSocketDown() : false
    if (!stopped) {
      const recovered = await terminateUnixSocketOwner(controlSocketPath)
      if (job !== undefined) {
        appendJobEvent(job, {
          type: 'system',
          text: recovered.found
            ? `socket-owner recovery terminated pids=${recovered.terminated.join(',')} forced=${String(recovered.forced)}`
            : 'no control-socket owner found during recovery',
        })
      }
      stopped = await waitForControlSocketDown(5_000)
    }
    if (!stopped) throw new Error('could not stop the external core; stop the old core process manually and retry')
    return { stopped: true, external: true, recovered: true }
  }
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
  const install = await runCommand(job, 'bash', [installScript, download.path, '--sha256', download.sha256, '--core-root', coreRoot, '--force'])
  if (!install.ok) {
    lastUpdate.status = 'rolling-back'
    const rolled = await rollbackCore(job)
    lastUpdate.status = rolled.ok ? 'rolled-back' : 'failed'
    throw new Error(`core bundle installation failed; rollback ${rolled.ok ? 'succeeded' : 'failed'}`)
  }
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
      if (result.ok) {
        const preflight = await runPreflight(job)
        if (preflight.sandboxReady) {
          appendJobEvent(job, { type: 'system', text: '用户级环境准备完成；基础工具链和 sandbox runtime 均可用。' })
        } else {
          appendJobEvent(job, { type: 'system', text: '用户级环境准备完成，但 Docker sandbox runtime 不可用。基础 companion/core/worker 仍可用；Sandbox、Agent Migration 和 broker 容器能力需要你本人安装/启动 Docker 后再检查。' })
        }
      }
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
    } else if (job.kind === 'agent-migrate') {
      await executeAgentMigration(job)
      job.exitCode = 0
    } else if (job.kind === 'feishu4dsh-install') {
      const profile = validateFeishu4dshProfile(job.input?.profile)
      const packageSpec = validateFeishu4dshPackageSpec(job.input?.packageSpec)
      appendJobEvent(job, { type: 'system', text: `installing feishu4dsh into dsh profile ${profile}` })
      const dshCommand = defaultFeishu4dshPaths().dshCommand
      const result = await runCommand(job, dshCommand, ['plugin', '--profile', profile, 'add', packageSpec])
      job.exitCode = result.code
      if (result.ok) {
        appendJobEvent(job, {
          type: 'system',
          text: 'feishu4dsh plugin installed. Configure its 0600 env file and user service yourself; SHE does not read or store Feishu secrets.',
        })
      }
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
  if (DEV_JOB_KINDS.has(kind) && !sourceCheckout) {
    throw new Error('installed companion bundle does not include the source workspace; use Core install/update for runtime changes')
  }
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
    if (size > 256 * 1024) throw new Error('request body too large')
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

function requestBrokerJson(method, requestPath, payload) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error !== undefined) rejectPromise(error)
      else resolvePromise(value)
    }
    readToken(brokerTokenFile).then(token => {
      const body = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload), 'utf8')
      const brokerRequest = httpRequest({
        socketPath: brokerSocketPath,
        path: requestPath,
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(body.byteLength) }),
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        timeout: 30_000,
      }, brokerResponse => {
        const chunks = []
        brokerResponse.on('data', chunk => chunks.push(Buffer.from(chunk)))
        brokerResponse.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed
          try { parsed = text === '' ? null : JSON.parse(text) } catch { parsed = null }
          if ((brokerResponse.statusCode ?? 500) >= 400 || parsed?.ok === false) {
            finish(new Error(parsed?.error?.message ?? `broker HTTP ${brokerResponse.statusCode ?? 500}`))
            return
          }
          finish(undefined, parsed?.value ?? null)
        })
      })
      brokerRequest.on('timeout', () => {
        brokerRequest.destroy()
        finish(new Error('broker request timed out'))
      })
      brokerRequest.on('error', error => finish(new Error(`broker unavailable: ${error.message}`)))
      if (body === undefined) brokerRequest.end()
      else brokerRequest.end(body)
    }).catch(error => finish(error))
  })
}

function requestControlJson(method, requestPath, payload) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error !== undefined) rejectPromise(error)
      else resolvePromise(value)
    }
    readToken(controlTokenFile).then(token => {
      const body = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload), 'utf8')
      const controlRequest = httpRequest({
        socketPath: controlSocketPath,
        path: requestPath,
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(body.byteLength) }),
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        timeout: 10_000,
      }, controlResponse => {
        const chunks = []
        controlResponse.on('data', chunk => chunks.push(Buffer.from(chunk)))
        controlResponse.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed
          try { parsed = text === '' ? null : JSON.parse(text) } catch { parsed = null }
          if ((controlResponse.statusCode ?? 500) >= 400 || parsed?.ok === false) {
            finish(new Error(parsed?.error?.message ?? `control plane HTTP ${controlResponse.statusCode ?? 500}`))
            return
          }
          finish(undefined, parsed?.value ?? null)
        })
      })
      controlRequest.on('timeout', () => {
        controlRequest.destroy()
        finish(new Error('control plane request timed out'))
      })
      controlRequest.on('error', error => finish(new Error(`control plane unavailable: ${error.message}`)))
      if (body === undefined) controlRequest.end()
      else controlRequest.end(body)
    }).catch(error => finish(error))
  })
}

async function waitForControlSocketDown(timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await probeSocket(controlSocketPath, controlTokenFile)
    if (!health.reachable) return true
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  return false
}

async function listMigrationRecords() {
  try {
    const entries = await import('node:fs/promises').then(fs => fs.readdir(migrationRecordRoot, { withFileTypes: true }))
    const records = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        records.push(JSON.parse(await readFile(join(migrationRecordRoot, entry.name), 'utf8')))
      } catch {}
    }
    return records.sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0)).slice(0, 50)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function executeAgentMigration(job) {
  const request = job.input?.request
  if (request === undefined || typeof request !== 'object') throw new Error('migration request is required')
  appendJobEvent(job, { type: 'system', text: '正在重新扫描本机 AI agent 服务并校验迁移边界…' })
  const workspaceAuthorizations = await listWorkspaceAuthorizations(workspaceRegistryPath)
  const { discovery, plan } = await discoverAndPlan({ request, managedWorkspaceRoot: migrationWorkspaceRoot, workspaceAuthorizations })
  appendJobEvent(job, { type: 'system', text: `发现 ${String(discovery.services.length)} 个候选条目，计划包含 ${String(plan.agents.length)} 个 agent。` })
  for (const warning of plan.warnings) {
    appendJobEvent(job, { type: 'system', text: `[${warning.severity}] ${warning.message}` })
  }
  if (plan.blocked) {
    for (const error of plan.errors) appendJobEvent(job, { type: 'system', text: `[blocked] ${error.message}` })
    throw new Error('migration plan is blocked; fix validation errors first')
  }

  const createdSandboxes = []
  const results = []
  try {
    for (const agent of plan.agents) {
      if (agent.workspaceMode === 'new') {
        await mkdir(agent.newWorkspacePath, { recursive: true, mode: 0o700 })
        appendJobEvent(job, { type: 'system', text: `已创建新工作空间：${agent.newWorkspacePath}` })
      }
      const spec = {
        name: agent.sandboxName,
        role: 'utility',
        agentId: agent.kind,
        image: plan.image,
        networkMode: plan.networkMode,
        resources: plan.resources,
        allowedCallers: ['main'],
        allowedTargets: [],
        labels: {
          'she.migration.id': plan.id,
          'she.migration.agent': agent.kind,
          'she.migration.source.pid': String(agent.pid ?? ''),
        },
        command: plan.command,
        hostMounts: agent.mounts,
      }
      appendJobEvent(job, { type: 'system', text: `创建 sandbox ${agent.sandboxName}（${agent.name}）…` })
      const sandbox = await requestBrokerJson('POST', '/v1/sandboxes', spec)
      createdSandboxes.push(agent.sandboxName)
      results.push({
        candidateId: agent.candidateId,
        kind: agent.kind,
        name: agent.name,
        sandboxName: agent.sandboxName,
        workspaceAuthorizationId: agent.workspaceAuthorizationId ?? null,
        sandboxStatus: sandbox?.status ?? 'unknown',
        workspaceMode: agent.workspaceMode,
        ...(agent.newWorkspacePath === undefined ? {} : { newWorkspacePath: agent.newWorkspacePath }),
        sourceWorkspacePath: agent.sourceWorkspacePath,
        legacyReadOnly: agent.legacyReadOnly,
        credentialMounts: agent.credentialMounts,
      })
      appendJobEvent(job, { type: 'system', text: `sandbox ${agent.sandboxName} 已创建；原进程未修改。` })
    }
  } catch (error) {
    appendJobEvent(job, { type: 'system', text: `迁移失败，回滚本次已创建的 sandbox：${error.message}` })
    for (const sandboxName of createdSandboxes) {
      try {
        await requestBrokerJson('DELETE', `/v1/sandboxes/${encodeURIComponent(sandboxName)}?preserveData=true`)
        appendJobEvent(job, { type: 'system', text: `已回滚 sandbox ${sandboxName}（保留数据目录）。` })
      } catch (rollbackError) {
        appendJobEvent(job, { type: 'system', text: `回滚 ${sandboxName} 失败：${rollbackError.message}` })
      }
    }
    throw error
  }

  const record = {
    schema: 1,
    id: plan.id,
    createdAt: plan.createdAt,
    finishedAt: Date.now(),
    status: 'succeeded',
    image: plan.image,
    command: plan.command,
    networkMode: plan.networkMode,
    resources: plan.resources,
    warnings: plan.warnings,
    agents: results,
    originalProcesses: discovery.services.filter(service => plan.agents.some(agent => agent.candidateId === service.id)),
    safety: {
      originalProcessesUntouched: true,
      credentialContentsRead: false,
      credentialMountsReadOnly: true,
    },
  }
  await mkdir(migrationRecordRoot, { recursive: true, mode: 0o700 })
  await writeFile(join(migrationRecordRoot, `${plan.id}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  appendJobEvent(job, { type: 'system', text: `迁移记录已写入：${join(migrationRecordRoot, `${plan.id}.json`)}` })
}

async function workerConfigStatus() {
  const detectedOpenCode = await inspectOpenCodeService().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    return {
      schema: 1,
      checkedAt: Date.now(),
      detected: false,
      url: 'http://127.0.0.1:49375',
      credentialFile: expandHome('~/.config/opencode/service.json'),
      username: 'opencode',
      stateFile: expandHome('~/.local/state/opencode/service.json'),
      configFile: expandHome('~/.config/opencode/service.json'),
      source: 'error',
      health: { ok: false, detail: message },
      error: message,
    }
  })
  const config = await readWorkerConfig(detectedOpenCode)
  return { config, path: workerConfigPath, restartRequired: false, detectedOpenCode }
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
        supervised: companionSupervised,
        sourceCheckout,
        ...(companionInstallRoot === undefined ? {} : { installRoot: companionInstallRoot }),
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
        updateBoundary: {
          selfUpdate: companionSupervised,
          method: companionSupervised ? 'supervisor-managed checksum-verified update' : 'checksum-verified companion installer',
          note: companionSupervised
            ? 'PWA requests update; the stable supervisor restarts the companion from the new version directory and rolls back if the new process exits during startup.'
            : 'Companion is not running under the launcher supervisor; restart/update from the page is unavailable.',
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
        api: ['health', 'version', 'capabilities', 'jobs', 'events', 'core-status', 'core-start-stop-restart', 'core-update-check', 'preflight', 'platform', 'packages', 'workspaces', 'worker-config', 'opencode-service', 'autostart', 'gateway', 'feishu-gateway', 'feishu4dsh', 'sandbox-preferences', 'sandbox-agent-recipes', 'companion-restart', 'companion-shutdown', 'companion-update-check', 'companion-update-apply', 'agents-discover', 'agent-migration-plan', 'agent-migration-apply', 'agent-migration-records'],
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
      let started
      if (action === 'start') started = await startCore()
      else if (action === 'stop') await stopCore()
      else { await stopCore(); started = await startCore() }
      const health = action === 'stop'
        ? { ok: true }
        : started?.alreadyRunning
          ? { ok: true, external: started.external === true, control: await probeSocket(controlSocketPath, controlTokenFile) }
          : await waitForCoreHealthy()
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
  if (request.method === 'POST' && /^\/api\/companion\/(restart|shutdown)$/.test(url.pathname)) {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    if (!companionSupervised) {
      sendJsonWithCors(request, response, 409, {
        ok: false,
        error: {
          code: 'conflict',
          message: 'companion is not running under the launcher supervisor; use start.sh/start.command/start.bat to restart it',
          retryable: false,
        },
      })
      return
    }
    const action = url.pathname.split('/').pop()
    sendJsonWithCors(request, response, 200, { ok: true, value: { action, restarting: action === 'restart', version: companionVersion } })
    scheduleCompanionExit(action === 'restart' ? COMPANION_RESTART_EXIT_CODE : 0, 500)
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/companion/update/check') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      sendJsonWithCors(request, response, 200, { ok: true, value: await checkCompanionUpdate(String(body.manifestUrl ?? '').trim()) })
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/companion/update/apply') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      const result = await applyCompanionUpdate(String(body.manifestUrl ?? '').trim())
      sendJsonWithCors(request, response, 200, { ok: true, value: result })
      scheduleCompanionExit(COMPANION_RESTART_EXIT_CODE, 500)
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/sandbox/agent-recipes') {
    sendJsonWithCors(request, response, 200, { ok: true, value: sandboxAgentRecipeCatalog() })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/sandbox/preferences') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await sandboxPreferencesStatus() })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/sandbox/preferences') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      await writeSandboxPreferences(sandboxPreferencesPath, body)
      sendJsonWithCors(request, response, 200, { ok: true, value: await sandboxPreferencesStatus() })
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/opencode/service') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await inspectOpenCodeService() })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/feishu/gateway/status') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await feishuGateway.status() })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/feishu/gateway/config') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      sendJsonWithCors(request, response, 200, { ok: true, value: await feishuGateway.save(body) })
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && /^\/api\/feishu\/gateway\/(start|stop)$/.test(url.pathname)) {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const action = url.pathname.split('/').pop()
      const value = action === 'start' ? await feishuGateway.start() : await feishuGateway.stop()
      sendJsonWithCors(request, response, 200, { ok: true, value })
    } catch (error) {
      sendJsonWithCors(request, response, 409, { ok: false, error: { code: 'conflict', message: error.message, retryable: true } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/feishu4dsh') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await inspectFeishu4dsh() })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/gateway') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await gatewayStatus() })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/gateway') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      const current = await readGatewayConfig(gatewayConfigPath)
      await writeGatewayConfig(gatewayConfigPath, {
        enabled: body.enabled === true,
        adapterHealthUrl: body.adapterHealthUrl ?? current.adapterHealthUrl,
      })
      sendJsonWithCors(request, response, 200, { ok: true, value: await gatewayStatus() })
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/autostart') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await autostartStatus(autostartOptionsFromEnv()) })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/autostart') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      const options = autostartOptionsFromEnv()
      const status = body.enabled === true ? await enableAutostart(options) : await disableAutostart(options)
      sendJsonWithCors(request, response, 200, { ok: true, value: status })
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
  if (request.method === 'GET' && url.pathname === '/api/worker/config') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await workerConfigStatus() })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/worker/config') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      const config = await saveWorkerConfig(body)
      sendJsonWithCors(request, response, 200, {
        ok: true,
        value: {
          config,
          path: workerConfigPath,
          restartRequired: true,
          detectedOpenCode: await inspectOpenCodeService().catch(() => undefined),
        },
      })
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/agents/discover') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await scanLocalAgents() })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/agents/migrations/plan') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      const workspaceAuthorizations = await listWorkspaceAuthorizations(workspaceRegistryPath)
      const result = await discoverAndPlan({ request: body, managedWorkspaceRoot: migrationWorkspaceRoot, workspaceAuthorizations })
      sendJsonWithCors(request, response, 200, { ok: true, value: result })
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/agents/migrations/apply') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      const job = startJob('agent-migrate', { request: body })
      sendJsonWithCors(request, response, 202, { ok: true, value: jobSummary(job) })
    } catch (error) {
      sendJsonWithCors(request, response, 409, { ok: false, error: { code: 'conflict', message: error.message, retryable: true } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/agents/migrations') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await listMigrationRecords() })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && /^\/api\/agents\/migrations\/[^/]+$/.test(url.pathname)) {
    try {
      const recordId = decodeURIComponent(url.pathname.split('/').pop() ?? '')
      if (!/^mig-[a-zA-Z0-9-]+$/.test(recordId)) throw new Error('invalid migration id')
      const record = JSON.parse(await readFile(join(migrationRecordRoot, `${recordId}.json`), 'utf8'))
      sendJsonWithCors(request, response, 200, { ok: true, value: record })
    } catch (error) {
      sendJsonWithCors(request, response, 404, { ok: false, error: { code: 'not_found', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/platform') {
    try {
      sendJsonWithCors(request, response, 200, { ok: true, value: await platformStatus() })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/workspaces') {
    try {
      sendJsonWithCors(request, response, 200, {
        ok: true,
        value: {
          path: workspaceRegistryPath,
          workspaces: await listWorkspaceAuthorizations(workspaceRegistryPath),
        },
      })
    } catch (error) {
      sendJsonWithCors(request, response, 500, { ok: false, error: { code: 'internal', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/workspaces') {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      const body = await readBodyJson(request)
      const workspace = await authorizeWorkspace(workspaceRegistryPath, body)
      sendJsonWithCors(request, response, 200, {
        ok: true,
        value: { path: workspaceRegistryPath, workspace, workspaces: await listWorkspaceAuthorizations(workspaceRegistryPath) },
      })
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  const workspaceDeleteMatch = /^\/api\/workspaces\/([^/]+)$/.exec(url.pathname)
  if (request.method === 'DELETE' && workspaceDeleteMatch !== null) {
    if (request.headers['x-she-local-action'] !== '1') {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: 'missing local action header', retryable: false } })
      return
    }
    try {
      await removeWorkspaceAuthorization(workspaceRegistryPath, decodeURIComponent(workspaceDeleteMatch[1]))
      sendJsonWithCors(request, response, 200, {
        ok: true,
        value: { path: workspaceRegistryPath, workspaces: await listWorkspaceAuthorizations(workspaceRegistryPath) },
      })
    } catch (error) {
      sendJsonWithCors(request, response, 400, { ok: false, error: { code: 'invalid_request', message: error.message, retryable: false } })
    }
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/packages') {
    sendJsonWithCors(request, response, 200, { ok: true, value: await packageCatalog() })
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
    const noCache = file.endsWith('index.html') || file.endsWith('sw.js') || file.endsWith('manifest.webmanifest') || /start\.(?:sh|command|ps1|bat)$/.test(file)
    response.setHeader('cache-control', noCache ? 'no-cache' : 'public, max-age=31536000, immutable')
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
