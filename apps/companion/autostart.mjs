/** User-level login autostart management for the stable companion supervisor. */

import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { resolveShePaths } from './paths.mjs'

const execFileAsync = promisify(execFile)

function systemdQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildSystemdUnit(options) {
  const home = dirname(options.installRoot)
  return `[Unit]
Description=SHE App
After=network-online.target

[Service]
Type=simple
Environment=${systemdQuote(`SHE_HOME=${home}`)}
Environment=${systemdQuote(`SHE_PWA_PORT=${options.port}`)}
Environment=${systemdQuote(`SHE_COMPANION_ROOT=${options.installRoot}`)}
Environment=${systemdQuote(`SHE_BIN_DIR=${options.binDir}`)}
Environment=${systemdQuote(`SHE_CORE_ROOT=${home}/core`)}
Environment=${systemdQuote(`SHE_CONFIG_HOME=${home}/config`)}
Environment=${systemdQuote(`SHE_STATE_HOME=${home}/state`)}
Environment=${systemdQuote(`SHE_RUNTIME_DIR=${home}/run`)}
Environment=${systemdQuote(`SHE_WORKSPACE_ROOT=${home}/workspaces`)}
ExecStart=${systemdQuote(options.execPath)} ${systemdQuote(join(options.installRoot, 'launcher.mjs'))}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`
}

export function buildLaunchAgentPlist(options) {
  const home = dirname(options.installRoot)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.she.companion</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(options.execPath)}</string>
    <string>${xmlEscape(join(options.installRoot, 'launcher.mjs'))}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SHE_HOME</key><string>${xmlEscape(home)}</string>
    <key>SHE_PWA_PORT</key><string>${xmlEscape(options.port)}</string>
    <key>SHE_COMPANION_ROOT</key><string>${xmlEscape(options.installRoot)}</string>
    <key>SHE_BIN_DIR</key><string>${xmlEscape(options.binDir)}</string>
    <key>SHE_CORE_ROOT</key><string>${xmlEscape(join(home, 'core'))}</string>
    <key>SHE_CONFIG_HOME</key><string>${xmlEscape(join(home, 'config'))}</string>
    <key>SHE_STATE_HOME</key><string>${xmlEscape(join(home, 'state'))}</string>
    <key>SHE_RUNTIME_DIR</key><string>${xmlEscape(join(home, 'run'))}</string>
    <key>SHE_WORKSPACE_ROOT</key><string>${xmlEscape(join(home, 'workspaces'))}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`
}

export function buildWindowsStartupCmd(options) {
  const home = dirname(options.installRoot)
  return `@echo off\r\nset "SHE_HOME=${home}"\r\nset "SHE_PWA_PORT=${options.port}"\r\nset "SHE_COMPANION_ROOT=${options.installRoot}"\r\nset "SHE_BIN_DIR=${options.binDir}"\r\nset "SHE_CORE_ROOT=${join(home, 'core')}"\r\nset "SHE_CONFIG_HOME=${join(home, 'config')}"\r\nset "SHE_STATE_HOME=${join(home, 'state')}"\r\nset "SHE_RUNTIME_DIR=${join(home, 'run')}"\r\nset "SHE_WORKSPACE_ROOT=${join(home, 'workspaces')}"\r\nstart "" /min "${options.execPath}" "${join(options.installRoot, 'launcher.mjs')}"\r\n`
}

async function pathExists(path) {
  try { await access(path); return true } catch { return false }
}

async function run(command, args) {
  try {
    await execFileAsync(command, args, { timeout: 10_000, encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

export async function autostartStatus(options) {
  if (!options.installRoot) return { enabled: false, mode: 'unsupported', path: null, note: 'companion install root is unknown' }
  if (options.platform === 'linux') {
    const unitPath = join(options.configHome, 'systemd', 'user', 'she-companion.service')
    const desktopPath = join(options.configHome, 'autostart', 'she-companion.desktop')
    if (await pathExists(unitPath)) return { enabled: true, mode: 'systemd-user', path: unitPath, note: '登录后由 systemd --user 启动；不是系统级 root 服务。' }
    if (await pathExists(desktopPath)) return { enabled: true, mode: 'xdg-autostart', path: desktopPath, note: '桌面登录时启动。' }
    return { enabled: false, mode: 'disabled', path: unitPath, note: '未启用登录自启动。' }
  }
  if (options.platform === 'darwin') {
    const plistPath = join(options.home, 'Library', 'LaunchAgents', 'dev.she.companion.plist')
    return { enabled: await pathExists(plistPath), mode: 'launch-agent', path: plistPath, note: '登录时由 launchd 启动。' }
  }
  if (options.platform === 'win32') {
    const startupPath = join(options.appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'she-companion.cmd')
    return { enabled: await pathExists(startupPath), mode: 'windows-startup', path: startupPath, note: '用户登录时从 Startup 文件夹启动。' }
  }
  return { enabled: false, mode: 'unsupported', path: null, note: '当前平台暂不支持自启动。' }
}

export async function enableAutostart(options) {
  if (!options.installRoot) throw new Error('companion install root is unknown')
  const status = await autostartStatus(options)
  if (status.enabled) return status
  if (options.platform === 'linux') {
    const unitPath = join(options.configHome, 'systemd', 'user', 'she-companion.service')
    const desktopPath = join(options.configHome, 'autostart', 'she-companion.desktop')
    const unit = buildSystemdUnit(options)
    await mkdir(join(options.configHome, 'systemd', 'user'), { recursive: true, mode: 0o700 })
    await writeFile(unitPath, unit, { mode: 0o644 })
    const reloaded = await run('systemctl', ['--user', 'daemon-reload'])
    const enabled = reloaded && await run('systemctl', ['--user', 'enable', 'she-companion.service'])
    if (enabled) return autostartStatus(options)
    // Fallback for desktops without a usable user systemd manager.
    await unlink(unitPath).catch(() => undefined)
    const home = dirname(options.installRoot)
    const exec = `env SHE_HOME=${systemdQuote(home)} SHE_PWA_PORT=${options.port} SHE_COMPANION_ROOT=${systemdQuote(options.installRoot)} SHE_BIN_DIR=${systemdQuote(options.binDir)} SHE_CORE_ROOT=${systemdQuote(join(home, 'core'))} SHE_CONFIG_HOME=${systemdQuote(join(home, 'config'))} SHE_STATE_HOME=${systemdQuote(join(home, 'state'))} SHE_RUNTIME_DIR=${systemdQuote(join(home, 'run'))} SHE_WORKSPACE_ROOT=${systemdQuote(join(home, 'workspaces'))} ${systemdQuote(options.execPath)} ${systemdQuote(join(options.installRoot, 'launcher.mjs'))}`
    const desktop = `[Desktop Entry]\nType=Application\nName=SHE Companion\nComment=SHE local companion\nExec=${exec}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`
    await mkdir(join(options.configHome, 'autostart'), { recursive: true, mode: 0o700 })
    await writeFile(desktopPath, desktop, { mode: 0o644 })
    return autostartStatus(options)
  }
  if (options.platform === 'darwin') {
    const plistPath = join(options.home, 'Library', 'LaunchAgents', 'dev.she.companion.plist')
    await mkdir(join(options.home, 'Library', 'LaunchAgents'), { recursive: true, mode: 0o700 })
    await writeFile(plistPath, buildLaunchAgentPlist(options), { mode: 0o644 })
    return autostartStatus(options)
  }
  if (options.platform === 'win32') {
    const startupDir = join(options.appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
    await mkdir(startupDir, { recursive: true })
    await writeFile(join(startupDir, 'she-companion.cmd'), buildWindowsStartupCmd(options), { mode: 0o644 })
    return autostartStatus(options)
  }
  throw new Error('autostart is not supported on this platform')
}

export async function disableAutostart(options) {
  if (options.platform === 'linux') {
    const unitPath = join(options.configHome, 'systemd', 'user', 'she-companion.service')
    const desktopPath = join(options.configHome, 'autostart', 'she-companion.desktop')
    await run('systemctl', ['--user', 'disable', 'she-companion.service'])
    await Promise.all([rm(unitPath, { force: true }), rm(desktopPath, { force: true })])
  } else if (options.platform === 'darwin') {
    const plistPath = join(options.home, 'Library', 'LaunchAgents', 'dev.she.companion.plist')
    await run('launchctl', ['unload', '-w', plistPath])
    await rm(plistPath, { force: true })
  } else if (options.platform === 'win32') {
    const startupPath = join(options.appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'she-companion.cmd')
    await rm(startupPath, { force: true })
  }
  return autostartStatus(options)
}

export function autostartOptionsFromEnv(env = process.env) {
  const platform = process.platform
  const paths = resolveShePaths(env)
  return {
    platform,
    home: homedir(),
    configHome: paths.configRoot,
    appData: env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming'),
    installRoot: env.SHE_COMPANION_ROOT?.trim() || paths.appRoot,
    binDir: env.SHE_BIN_DIR?.trim() || paths.binDir,
    port: Number(env.SHE_PWA_PORT ?? 8787),
    execPath: process.execPath,
  }
}
