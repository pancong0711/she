/** Read-only feishu4dsh installation/status inspection. Never reads secret values. */

import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export const FEISHU4DSH_SOURCE_URL = 'git+https://github.com/pancong0711/feishu4dsh.git'

export function defaultFeishu4dshPaths(env = process.env, home = homedir()) {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, '.config')
  const dshHome = env.DSH_HOME?.trim() || join(home, '.dsh')
  const profile = env.SHE_FEISHU4DSH_PROFILE?.trim() || 'feishu4dsh'
  return {
    dshCommand: env.SHE_DSH_BIN?.trim() || (process.platform === 'win32' ? 'dsh.cmd' : 'dsh'),
    profile,
    dshHome,
    profileDir: join(dshHome, 'profiles', profile),
    profilePackageFile: join(dshHome, 'profiles', profile, 'package.json'),
    envFile: env.FEISHU4DSH_ENV_FILE?.trim() || join(configHome, 'feishu4dsh', 'feishu4dsh.env'),
    unitFile: env.SHE_FEISHU4DSH_UNIT_FILE?.trim() || join(configHome, 'systemd', 'user', 'dsh-feishu4dsh.service'),
  }
}

export function validateFeishu4dshProfile(value) {
  const profile = String(value ?? 'feishu4dsh').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(profile)) {
    throw new Error('dsh profile name is invalid')
  }
  return profile
}

export function validateFeishu4dshPackageSpec(value) {
  const spec = String(value ?? '').trim()
  if (spec === '') throw new Error('feishu4dsh install source must not be empty')
  if (spec.length > 500) throw new Error('feishu4dsh install source is too long')
  if (/[\s\0\r\n]/.test(spec)) throw new Error('feishu4dsh install source must not contain whitespace or control characters')
  if (spec.startsWith('-')) throw new Error('feishu4dsh install source must not start with a dash')
  if (!/^(?:git\+https?:\/\/|https?:\/\/|file:|\.{0,2}\/|[A-Za-z0-9@][A-Za-z0-9._/@:+-]*$)/.test(spec)) {
    throw new Error('feishu4dsh install source must be an npm package, git URL or local path')
  }
  return spec
}

function capture(command, args, timeoutMs = 5_000) {
  return new Promise(resolvePromise => {
    const stdout = []
    const stderr = []
    let settled = false
    let child
    const finish = result => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }
    try {
      child = spawn(command, args, {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      finish({ ok: false, code: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) })
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ ok: false, code: null, stdout: stdout.join(''), stderr: 'command timed out' })
    }, timeoutMs)
    child.stdout.on('data', chunk => stdout.push(String(chunk)))
    child.stderr.on('data', chunk => stderr.push(String(chunk)))
    child.on('error', error => {
      clearTimeout(timer)
      finish({
        ok: false,
        code: 127,
        stdout: stdout.join(''),
        stderr: error?.code === 'ENOENT' ? `command not found: ${command}` : error.message,
      })
    })
    child.on('close', code => {
      clearTimeout(timer)
      finish({ ok: code === 0, code: code ?? 1, stdout: stdout.join('').trim(), stderr: stderr.join('').trim() })
    })
  })
}

export function inspectEnvFile(text, mode) {
  const content = String(text ?? '')
  const has = name => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*\\S+`, 'm').test(content)
  const appIdConfigured = has('FEISHU_APP_ID')
  const appSecretConfigured = has('FEISHU_APP_SECRET')
  return {
    appIdConfigured,
    appSecretConfigured,
    permissionsOk: typeof mode === 'number' ? (mode & 0o777) === 0o600 : undefined,
  }
}

async function fileInfo(path) {
  try {
    const value = await stat(path)
    return { exists: true, mode: value.mode & 0o777 }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false }
    throw error
  }
}

export async function inspectFeishu4dsh(options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const paths = defaultFeishu4dshPaths(env, home)
  const run = options.runCommand ?? capture
  const dsh = await run(paths.dshCommand, ['--version'])

  let profilePackage = null
  try {
    profilePackage = JSON.parse(await readFile(paths.profilePackageFile, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  const dependencySpec = profilePackage?.dependencies?.feishu4dsh
    ?? profilePackage?.devDependencies?.feishu4dsh
    ?? profilePackage?.dsh?.bundles?.includes?.('feishu4dsh')
    ?? null
  const pluginInstalled = dependencySpec !== null && dependencySpec !== undefined

  const envFile = await fileInfo(paths.envFile)
  let envState = { appIdConfigured: false, appSecretConfigured: false, permissionsOk: undefined }
  if (envFile.exists) {
    envState = inspectEnvFile(await readFile(paths.envFile, 'utf8'), envFile.mode)
  }
  const unitFile = await fileInfo(paths.unitFile)
  let service = { unitExists: unitFile.exists, enabled: false, active: false, systemdAvailable: false, detail: undefined }
  if (process.platform === 'linux') {
    const unitName = paths.unitFile.split(/[\\/]/).pop()
    const [enabled, active] = await Promise.all([
      run('systemctl', ['--user', 'is-enabled', unitName]),
      run('systemctl', ['--user', 'is-active', unitName]),
    ])
    service = {
      unitExists: unitFile.exists,
      enabled: enabled.ok && enabled.stdout.trim() === 'enabled',
      active: active.ok && active.stdout.trim() === 'active',
      systemdAvailable: !/command not found|timed out/i.test(enabled.stderr),
      ...(enabled.ok || active.ok ? {} : { detail: (enabled.stderr || active.stderr || '').slice(0, 240) || undefined }),
    }
  }

  const prerequisitesReady = dsh.ok
    && pluginInstalled
    && envFile.exists
    && envState.appIdConfigured
    && envState.appSecretConfigured
    && envState.permissionsOk !== false
  return {
    schema: 1,
    checkedAt: Date.now(),
    dsh: {
      command: paths.dshCommand,
      available: dsh.ok,
      version: dsh.ok ? dsh.stdout || dsh.stderr : null,
      detail: dsh.ok ? undefined : dsh.stderr,
    },
    profile: {
      name: paths.profile,
      directory: paths.profileDir,
      packageFile: paths.profilePackageFile,
      initialized: profilePackage !== null,
      pluginInstalled,
      dependencySpec,
    },
    envFile: {
      path: paths.envFile,
      exists: envFile.exists,
      mode: envFile.mode,
      appIdConfigured: envState.appIdConfigured,
      appSecretConfigured: envState.appSecretConfigured,
      permissionsOk: envState.permissionsOk,
      note: 'SHE 只检查变量名和文件权限，不读取或返回 secret 值。',
    },
    service,
    prerequisitesReady,
    commands: {
      installPlugin: `dsh plugin --profile ${paths.profile} add ${FEISHU4DSH_SOURCE_URL}`,
      installService: 'bash scripts/install-user-services.sh --dry-run',
      enableService: 'bash scripts/install-user-services.sh --enable',
      logs: 'journalctl --user -u dsh-feishu4dsh.service -f',
    },
    notes: [
      '安装 feishu4dsh 只完成飞书 ↔ dsh 通道插件；SHE 的 gateway.v1 适配仍需 feishu4dsh 侧实现并完成 T4.6 真机联调。',
      '飞书 app secret 必须写在 feishu4dsh 自己的 0600 环境文件里；SHE 不读取、不保存、不传给 agent。',
      'SHE 不自动执行 sudo；user service、linger 和系统依赖由用户本人确认。',
    ],
  }
}
