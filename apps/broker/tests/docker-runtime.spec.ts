import { describe, expect, it } from 'vitest'
import { bindMountArg, buildDockerRunArgs, type DockerContainerSpec } from '@she/broker'

function spec(overrides: Partial<DockerContainerSpec> = {}): DockerContainerSpec {
  return {
    containerName: 'she-sbx-test',
    sandboxName: 'sbx-test',
    role: 'worker',
    image: 'node:24-bookworm',
    networkMode: 'egress',
    workspacePath: '/host/sandboxes/sbx-test/workspace',
    inboxPath: '/host/sandboxes/sbx-test/inbox',
    outboxPath: '/host/sandboxes/sbx-test/outbox',
    homePath: '/host/sandboxes/sbx-test/home',
    cachePath: '/host/sandboxes/sbx-test/cache',
    resources: { cpus: 1, memoryMb: 1024, pids: 256 },
    command: ['sleep', 'infinity'],
    ...overrides,
  }
}

function mountValues(args: readonly string[]): string[] {
  return args.flatMap((arg, index) => arg === '--mount' ? [args[index + 1]!] : [])
}

describe('Docker run argv', () => {
  it('uses valid read-write and read-only --mount syntax', () => {
    const args = buildDockerRunArgs(spec({
      extraMounts: [
        { source: '/host/legacy', destination: '/legacy', readOnly: true },
        { source: '/host/extra', destination: '/home/agent/extra', readOnly: false },
      ],
    }))
    const mounts = mountValues(args)
    expect(mounts).toEqual([
      'type=bind,src=/host/sandboxes/sbx-test/workspace,dst=/workspace',
      'type=bind,src=/host/sandboxes/sbx-test/inbox,dst=/inbox,readonly',
      'type=bind,src=/host/sandboxes/sbx-test/outbox,dst=/outbox',
      'type=bind,src=/host/sandboxes/sbx-test/home,dst=/home/agent',
      'type=bind,src=/host/sandboxes/sbx-test/cache,dst=/cache',
      'type=bind,src=/host/legacy,dst=/legacy,readonly',
      'type=bind,src=/host/extra,dst=/home/agent/extra',
    ])
    expect(mounts.some(mount => mount.endsWith(',rw'))).toBe(false)
  })

  it('marks a read-only workspace and preserves fixed hardening flags', () => {
    const args = buildDockerRunArgs(spec({ workspaceReadOnly: true }))
    expect(bindMountArg('/src', '/dst', false)).toBe('type=bind,src=/src,dst=/dst')
    expect(bindMountArg('/src', '/dst', true)).toBe('type=bind,src=/src,dst=/dst,readonly')
    expect(args).toContain('--read-only')
    expect(args).toContain('no-new-privileges')
    expect(args).toContain('sleep')
    expect(args.slice(-2)).toEqual(['sleep', 'infinity'])
    expect(mountValues(args)[0]).toContain(',readonly')
  })
})
