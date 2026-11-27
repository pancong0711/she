#!/usr/bin/env node
/** CLI wrapper for the SHE app-shell home migration helper. */

import { pathToFileURL } from 'node:url'
import { migrateSheHome, planSheHomeMigration } from '../apps/companion/home-migration.mjs'

async function main() {
  const apply = process.argv.includes('--apply')
  const plan = await planSheHomeMigration()
  const report = apply ? await migrateSheHome() : { schema: 1, dryRun: true, plan }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!apply) process.stdout.write('\nDry run only. Re-run with --apply to copy into SHE_HOME.\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
