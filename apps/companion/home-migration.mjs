/** Conservative copy of the legacy SHE layout into the unified SHE_HOME layout. */

import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { legacyShePaths, resolveShePaths } from './paths.mjs'

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

export async function planSheHomeMigration(env = process.env, options = {}) {
  const paths = resolveShePaths(env, options)
  const legacy = legacyShePaths(env, options)
  const items = [
    { name: 'app', from: legacy.appRoot, to: join(paths.home, 'app') },
    { name: 'config', from: legacy.configRoot, to: join(paths.home, 'config') },
    { name: 'state', from: legacy.stateRoot, to: join(paths.home, 'state') },
  ]
  return Promise.all(items.map(async item => ({
    ...item,
    sourceExists: await exists(item.from),
    targetExists: await exists(item.to),
    needed: await exists(item.from) && !await exists(item.to),
  })))
}

export async function migrateSheHome(env = process.env, options = {}) {
  const plan = await planSheHomeMigration(env, options)
  const paths = resolveShePaths(env, options)
  await mkdir(paths.home, { recursive: true, mode: 0o700 })
  const copied = []
  const skipped = []
  for (const item of plan) {
    if (!item.sourceExists) {
      skipped.push({ ...item, reason: 'source missing' })
      continue
    }
    if (item.targetExists) {
      skipped.push({ ...item, reason: 'target already exists' })
      continue
    }
    await mkdir(dirname(item.to), { recursive: true, mode: 0o700 })
    await cp(item.from, item.to, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true })
    copied.push(item)
  }
  const report = {
    schema: 1,
    migratedAt: new Date().toISOString(),
    sheHome: paths.home,
    copied,
    skipped,
    legacyRoots: legacyShePaths(env, options),
    note: 'Legacy directories were copied, not deleted. Restart SHE and verify data before removing the old directories.',
  }
  await writeFile(join(paths.home, 'migration.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return report
}
