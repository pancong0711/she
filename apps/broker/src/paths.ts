/** Fixed-path and path-containment helpers for the sandbox broker. */

import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { BrokerError } from './errors.js'

export interface SandboxPaths {
  readonly root: string
  readonly workspace: string
  readonly inbox: string
  readonly outbox: string
  readonly home: string
  readonly cache: string
  readonly logs: string
  readonly descriptor: string
}

export function expandHome(path: string): string {
  if (path === '~') return homedir()
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

export function defaultSandboxDataRoot(): string {
  return join(homedir(), '.local', 'share', 'she', 'sandboxes')
}

export function assertSandboxName(name: string): string {
  if (!/^sbx-[a-z0-9][a-z0-9-]{0,59}$/.test(name)) {
    throw new BrokerError('invalid_request', 'sandbox name must match sbx-[a-z0-9-]')
  }
  return name
}

export function assertSafeRelative(value: string, label: string): string {
  if (value.trim() === '' || isAbsolute(value)) {
    throw new BrokerError('path_escape', `${label} must be a non-empty relative path`)
  }
  const normalized = value.replace(/\\/g, '/')
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '..' || segment === '' || segment === '.')) {
    throw new BrokerError('path_escape', `${label} contains an unsafe path segment`)
  }
  return segments.join('/')
}

export function safeJoin(root: string, relativePath: string, label = 'path'): string {
  const safe = assertSafeRelative(relativePath, label)
  const resolvedRoot = resolve(root)
  const target = resolve(resolvedRoot, safe)
  const rel = relative(resolvedRoot, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new BrokerError('path_escape', `${label} escapes its allowed root`)
  }
  return target
}

export function sandboxPaths(dataRoot: string, name: string): SandboxPaths {
  const root = join(resolve(expandHome(dataRoot)), name)
  return {
    root,
    workspace: join(root, 'workspace'),
    inbox: join(root, 'inbox'),
    outbox: join(root, 'outbox'),
    home: join(root, 'home'),
    cache: join(root, 'cache'),
    logs: join(root, 'logs'),
    descriptor: join(root, 'sandbox.json'),
  }
}

export function relativeTo(root: string, child: string): string {
  const rel = relative(resolve(root), resolve(child))
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new BrokerError('path_escape', 'resolved path escapes its allowed root')
  }
  return rel.replace(/\\/g, '/')
}
