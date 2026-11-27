#!/usr/bin/env node
/** Deterministic manifest for a signed/checksum-verified companion bundle. */

import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const args = process.argv.slice(2).reduce((acc, item, index, list) => {
  if (item.startsWith('--') && list[index + 1] !== undefined) acc[item.slice(2)] = list[index + 1]
  return acc
}, {})
const repoRoot = resolve(args.root ?? process.cwd())
const bundle = resolve(args.bundle)
const launcher = args.launcher === undefined ? undefined : resolve(args.launcher)
const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'apps/companion/package.json'), 'utf8'))
const releaseTag = String(args['release-tag'] ?? `v${packageJson.version}-companion.1`)
const releaseBase = String(args['release-base'] ?? `https://github.com/pancong0711/she/releases/download/${releaseTag}`).replace(/\/+$/, '')
const commit = args.commit ?? (await execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'])).stdout.trim()
const bytes = await readFile(bundle)
const launcherBytes = launcher === undefined ? undefined : await readFile(launcher)
const manifest = {
  schema: 1,
  name: 'she-companion',
  version: packageJson.version,
  commit,
  generatedAt: new Date().toISOString(),
  node: packageJson.engines.node,
  protocols: { companionApi: 'v1' },
  entrypoint: { posix: 'apps/companion/server.mjs', windows: 'apps/companion/server.mjs' },
  bundle: {
    file: basename(bundle),
    url: `${releaseBase}/${basename(bundle)}`,
    bytes: (await stat(bundle)).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
  ...(launcherBytes === undefined ? {} : {
    launcher: {
      file: basename(launcher),
      url: `${releaseBase}/${basename(launcher)}`,
      bytes: (await stat(launcher)).size,
      sha256: createHash('sha256').update(launcherBytes).digest('hex'),
    },
  }),
  installers: {
    posix: 'install-companion.sh',
    windows: 'install-companion.ps1',
  },
}
const output = resolve(args.out ?? resolve(repoRoot, 'companion-release-manifest.json'))
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
process.stdout.write(`${output}\n`)
