/** Linux-only recovery for orphaned core processes that still own the control Unix socket. */

import { readFile, readdir, readlink } from 'node:fs/promises'

export function parseUnixSocketInode(text, socketPath) {
  const target = String(socketPath ?? '')
  if (target === '') return undefined
  for (const line of String(text ?? '').split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 8) continue
    const inode = parts[6]
    const path = parts.slice(7).join(' ')
    if (path === target && /^\d+$/.test(inode ?? '')) return inode
  }
  return undefined
}

export function isAllowedCoreProcess(commandLine) {
  const text = String(commandLine ?? '')
  return /(?:control-plane(?:\.mjs|\/dist\/main\.js|\b)|she-control-plane|run-core\.mjs)/i.test(text)
}

async function processUid(pid) {
  try {
    const status = await readFile(`/proc/${String(pid)}/status`, 'utf8')
    const match = /^Uid:\s+(\d+)/m.exec(status)
    return match === null ? undefined : Number(match[1])
  } catch {
    return undefined
  }
}

async function processCommandLine(pid) {
  try {
    const raw = await readFile(`/proc/${String(pid)}/cmdline`, 'utf8')
    return raw.split('\u0000').filter(Boolean).join(' ')
  } catch {
    return ''
  }
}

export async function findUnixSocketOwners(socketPath) {
  if (process.platform !== 'linux') return []
  const table = await readFile('/proc/net/unix', 'utf8')
  const inode = parseUnixSocketInode(table, socketPath)
  if (inode === undefined) return []
  const owners = []
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    if (!Number.isInteger(pid)) continue
    let fds
    try { fds = await readdir(`/proc/${String(pid)}/fd`) } catch { continue }
    let owns = false
    for (const fd of fds) {
      try {
        if (await readlink(`/proc/${String(pid)}/fd/${fd}`) === `socket:[${inode}]`) {
          owns = true
          break
        }
      } catch {}
    }
    if (!owns) continue
    owners.push({ pid, uid: await processUid(pid), commandLine: await processCommandLine(pid) })
  }
  return owners
}

export async function terminateUnixSocketOwner(socketPath, options = {}) {
  if (process.platform !== 'linux') throw new Error('automatic orphan-core recovery is currently Linux-only')
  const owners = await findUnixSocketOwners(socketPath)
  if (owners.length === 0) return { found: false, terminated: [], forced: false }
  const uid = typeof options.uid === 'number' ? options.uid : (typeof process.getuid === 'function' ? process.getuid() : undefined)
  const eligible = owners.filter(owner => owner.uid === uid && isAllowedCoreProcess(owner.commandLine))
  if (eligible.length === 0) {
    throw new Error(`control socket is owned by an unverified process (pids: ${owners.map(owner => owner.pid).join(', ')})`)
  }
  for (const owner of eligible) process.kill(owner.pid, 'SIGTERM')
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  while (Date.now() < deadline) {
    const remaining = await findUnixSocketOwners(socketPath)
    const alive = remaining.filter(owner => eligible.some(item => item.pid === owner.pid))
    if (alive.length === 0) return { found: true, terminated: eligible.map(owner => owner.pid), forced: false }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
  }
  for (const owner of eligible) {
    try { process.kill(owner.pid, 'SIGKILL') } catch {}
  }
  return { found: true, terminated: eligible.map(owner => owner.pid), forced: true }
}
