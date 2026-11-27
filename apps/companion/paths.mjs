/**
 * Canonical SHE user-level path resolution.
 *
 * SHE_HOME is the single app root:
 *   Linux/macOS: ${XDG_DATA_HOME:-~/.local/share}/she
 *   Windows:     %LOCALAPPDATA%\SHE
 *
 * Existing installations used a mix of XDG and LOCALAPPDATA paths. The
 * resolver prefers already existing legacy directories so an upgrade does not
 * silently strand an installed app/config/state. New installations use the
 * unified layout. A one-time migration can replace the legacy links later.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

function valueOf(env, key) {
  const value = env?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function pathApi(platform) {
  return platform === 'win32' ? win32 : posix
}

/** Compute the canonical SHE_HOME. */
export function resolveSheHome(env = process.env, options = {}) {
  const platform = options.platform ?? process.platform
  const api = pathApi(platform)
  const home = options.home ?? valueOf(env, 'HOME') ?? valueOf(env, 'USERPROFILE') ?? homedir()
  const explicit = valueOf(env, 'SHE_HOME')
  if (explicit !== undefined) return api.resolve(explicit)
  if (platform === 'win32') {
    const localAppData = valueOf(env, 'LOCALAPPDATA') ?? api.join(home, 'AppData', 'Local')
    return api.resolve(localAppData, 'SHE')
  }
  const dataHome = valueOf(env, 'XDG_DATA_HOME') ?? api.join(home, '.local', 'share')
  return api.resolve(dataHome, 'she')
}

/** Legacy locations used before SHE_HOME was introduced. */
export function legacyShePaths(env = process.env, options = {}) {
  const platform = options.platform ?? process.platform
  const api = pathApi(platform)
  const home = options.home ?? valueOf(env, 'HOME') ?? valueOf(env, 'USERPROFILE') ?? homedir()
  const localAppData = valueOf(env, 'LOCALAPPDATA') ?? api.join(home, 'AppData', 'Local')
  const dataHome = valueOf(env, 'XDG_DATA_HOME') ?? api.join(home, '.local', 'share')
  const configHome = valueOf(env, 'XDG_CONFIG_HOME') ?? api.join(home, '.config')
  const stateHome = valueOf(env, 'XDG_STATE_HOME') ?? api.join(home, '.local', 'state')
  const appRoot = platform === 'win32'
    ? api.resolve(localAppData, 'she', 'companion')
    : api.resolve(dataHome, 'she', 'companion')
  return {
    appRoot,
    coreRoot: api.resolve(dataHome, 'she', 'core'),
    configRoot: api.resolve(configHome, 'she'),
    stateRoot: api.resolve(stateHome, 'she'),
    binDir: platform === 'win32' ? api.resolve(localAppData, 'she', 'bin') : api.resolve(home, '.local', 'bin'),
    workspaceRoot: api.resolve(dataHome, 'she', 'workspaces'),
    sandboxRoot: api.resolve(dataHome, 'she', 'sandboxes'),
    migrationRecordRoot: api.resolve(dataHome, 'she', 'migrations'),
  }
}

function existingOr(defaultPath, legacyPath, exists) {
  return exists(defaultPath) || !exists(legacyPath) ? defaultPath : legacyPath
}

/**
 * Resolve every local runtime path from SHE_HOME and the documented overrides.
 * Explicit SHE_* overrides always win.
 */
export function resolveShePaths(env = process.env, options = {}) {
  const platform = options.platform ?? process.platform
  const api = pathApi(platform)
  const exists = options.exists ?? existsSync
  const home = options.home ?? valueOf(env, 'HOME') ?? valueOf(env, 'USERPROFILE') ?? homedir()
  const sheHome = resolveSheHome(env, { platform, home })
  const legacy = legacyShePaths(env, { platform, home })
  const envPath = (key, fallback) => {
    const override = valueOf(env, key)
    return override === undefined ? fallback : api.resolve(override)
  }
  const appRoot = envPath('SHE_COMPANION_ROOT', existingOr(api.join(sheHome, 'app'), legacy.appRoot, exists))
  const coreRoot = envPath('SHE_CORE_ROOT', existingOr(api.join(sheHome, 'core'), legacy.coreRoot, exists))
  const configRoot = envPath('SHE_CONFIG_HOME', existingOr(api.join(sheHome, 'config'), legacy.configRoot, exists))
  const stateRoot = envPath('SHE_STATE_HOME', existingOr(api.join(sheHome, 'state'), legacy.stateRoot, exists))
  const workspaceRoot = envPath('SHE_WORKSPACE_ROOT', existingOr(api.join(sheHome, 'workspaces'), legacy.workspaceRoot, exists))
  const sandboxRoot = envPath('SHE_SANDBOX_ROOT', existingOr(api.join(sheHome, 'sandboxes'), legacy.sandboxRoot, exists))
  const migrationRecordRoot = envPath('SHE_MIGRATION_RECORD_ROOT', existingOr(api.join(sheHome, 'migrations'), legacy.migrationRecordRoot, exists))
  const runtimeOverride = valueOf(env, 'SHE_RUNTIME_DIR')
  const xdgRuntime = valueOf(env, 'XDG_RUNTIME_DIR')
  const runtimeRoot = runtimeOverride !== undefined
    ? api.resolve(runtimeOverride)
    : xdgRuntime !== undefined
      ? api.resolve(xdgRuntime, 'she')
      : api.join(sheHome, 'run')
  const legacyAppSelected = appRoot === legacy.appRoot
  const binDir = envPath('SHE_BIN_DIR', legacyAppSelected && exists(legacy.binDir)
    ? legacy.binDir
    : api.join(sheHome, 'bin'))
  return {
    home: sheHome,
    appRoot,
    coreRoot,
    configRoot,
    stateRoot,
    runtimeRoot,
    workspaceRoot,
    sandboxRoot,
    migrationRecordRoot,
    binDir,
    legacy,
  }
}
