import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import {
  authorizeWorkspace,
  listWorkspaceAuthorizations,
  removeWorkspaceAuthorization,
} from '../workspaces.mjs'

const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'she-workspaces-'))
  cleanup.push(async () => rm(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  const project = join(home, 'projects', 'demo')
  const registryPath = join(root, 'config', 'workspaces.json')
  await mkdir(project, { recursive: true })
  return { root, home, project, registryPath }
}

describe('workspace authorization registry', () => {
  it('authorizes a leaf directory, enforces 0600 and supports removal', async () => {
    const { home, project, registryPath } = await fixture()
    const record = await authorizeWorkspace(registryPath, {
      label: 'demo project',
      path: project,
      mode: 'read-write',
    }, home)
    expect(record.id).toMatch(/^ws-[a-f0-9]{12}$/)
    expect(record.realPath).toBe(project)
    expect((await stat(registryPath)).mode & 0o777).toBe(0o600)
    expect(await readFile(registryPath, 'utf8')).toContain('demo project')

    const list = await listWorkspaceAuthorizations(registryPath, home)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ exists: true, isDirectory: true, writable: true, leafAuthorized: true })

    await removeWorkspaceAuthorization(registryPath, record.id)
    expect(await listWorkspaceAuthorizations(registryPath, home)).toEqual([])
  })

  it('rejects home, root and protected system paths', async () => {
    const { home, registryPath } = await fixture()
    await expect(authorizeWorkspace(registryPath, { path: home, mode: 'read-only' }, home))
      .rejects.toThrow(/主目录本身/)
    await expect(authorizeWorkspace(registryPath, { path: '/', mode: 'read-only' }, home))
      .rejects.toThrow(/根目录/)
    await expect(authorizeWorkspace(registryPath, { path: '/etc', mode: 'read-only' }, home))
      .rejects.toThrow(/受保护/)
  })

  it('allows read-only authorization for a non-writable directory but rejects read-write', async () => {
    const { home, project, registryPath } = await fixture()
    await chmod(project, 0o555)
    const readOnly = await authorizeWorkspace(registryPath, { path: project, mode: 'read-only' }, home)
    expect(readOnly.mode).toBe('read-only')
    await expect(authorizeWorkspace(registryPath, { path: project, mode: 'read-write' }, home))
      .rejects.toThrow(/writable/)
  })
})
