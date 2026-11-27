#!/usr/bin/env node
/** Deterministic SHE release manifest generator. */

import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) continue
    out[key.slice(2)] = value
    i += 1
  }
  return out
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

const args = parseArgs(process.argv.slice(2))
const repoRoot = resolve(args.root ?? process.cwd())
const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'apps/control-plane/package.json'), 'utf8'))
const commit = args.commit ?? (await execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'])).stdout.trim()
const releaseTag = String(args['release-tag'] ?? `v${packageJson.version}-core.1`)
const releaseBase = String(args['release-base'] ?? `https://github.com/pancong0711/she/releases/download/${releaseTag}`).replace(/\/+$/, '')
const channelBase = String(args['channel-base'] ?? 'https://pancong0711.github.io/she').replace(/\/+$/, '')
const bundle = args.bundle ? resolve(repoRoot, args.bundle) : undefined
const bundleInfo = bundle === undefined ? undefined : {
  file: basename(bundle),
  url: `${channelBase}/${basename(bundle)}`,
  fallbackUrl: `${releaseBase}/${basename(bundle)}`,
  bytes: (await stat(bundle)).size,
  sha256: await sha256(bundle),
}
const manifest = {
  schema: 1,
  name: 'she',
  version: packageJson.version,
  commit,
  generatedAt: new Date().toISOString(),
  protocols: {
    companionApi: 'v1',
    gateway: 'v1',
    agent: 'v1',
    sandbox: 'v1',
  },
  entrypoint: {
    posix: 'run-core.sh',
    windows: 'run-core.cmd',
    args: [],
  },
  ...(bundleInfo === undefined ? {} : { bundle: bundleInfo }),
}
const output = args.out ? resolve(repoRoot, args.out) : resolve(repoRoot, 'release-manifest.json')
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
process.stdout.write(`${output}\n`)
