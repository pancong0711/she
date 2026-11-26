import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error companion is a dependency-free ESM layer and intentionally
// does not add a second TypeScript build for its local helper module.
import {
  buildMigrationPlan,
  classifyProcess,
  parseListeningPorts,
  parseProcessList,
  redactCommand,
} from '../local-agents.mjs'

const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'she-agent-migration-'))
  cleanup.push(async () => rm(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  const project = join(root, 'project')
  const credentials = join(home, '.config', 'opencode')
  const workspaces = join(home, '.local', 'share', 'she', 'workspaces')
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(project, { recursive: true }),
    mkdir(credentials, { recursive: true }),
    mkdir(workspaces, { recursive: true }),
  ])
  return { root, home, project, credentials, workspaces }
}

describe('local AI agent discovery helpers', () => {
  it('parses process metadata, classifies known agents and redacts secrets', () => {
    const processes = parseProcessList([
      '  123   1 opencode opencode serve --hostname 127.0.0.1 --port 49375 --api-key sk-super-secret-value',
      '  124   1 node node /usr/lib/example/server.js --token=another-secret',
      '  125   1 grep grep claude',
    ].join('\n'))
    expect(processes).toHaveLength(3)
    expect(classifyProcess(processes[0])?.kind).toBe('opencode')
    expect(classifyProcess(processes[2])).toBeUndefined()
    expect(redactCommand(processes[0]?.args ?? '')).toContain('--api-key <redacted>')
    expect(redactCommand(processes[0]?.args ?? '')).not.toContain('super-secret')
  })

  it('maps listening socket owners to ports', () => {
    const ports = parseListeningPorts([
      'LISTEN 0 4096 127.0.0.1:49375 0.0.0.0:* users:(("opencode",pid=123,fd=9))',
      'LISTEN 0 4096 [::1]:11434 [::]:* users:(("ollama",pid=321,fd=3))',
    ].join('\n'))
    expect([...(ports.get(123) ?? [])]).toEqual([49375])
    expect([...(ports.get(321) ?? [])]).toEqual([11434])
  })
})

describe('agent migration planning', () => {
  it('builds an isolated new-workspace plan with read-only legacy and credential mounts', async () => {
    const { home, project, credentials, workspaces } = await fixture()
    const realHome = await realpath(home)
    const realProject = await realpath(project)
    const realCredentials = await realpath(credentials)
    const discovery = {
      home: realHome,
      services: [{
        id: 'running:opencode:123',
        kind: 'opencode',
        name: 'OpenCode',
        running: true,
        pid: 123,
        cwd: realProject,
        ports: [49375],
        warnings: [],
        containerizable: true,
      }],
    }
    const plan = await buildMigrationPlan({
      discovery,
      managedWorkspaceRoot: workspaces,
      request: {
        image: 'node:22-bookworm-slim',
        command: ['sleep', 'infinity'],
        networkMode: 'none',
        agents: [{
          id: 'running:opencode:123',
          sourceWorkspacePath: realProject,
          workspaceMode: 'new',
          legacyReadOnly: true,
          credentialPaths: [realCredentials],
        }],
      },
    })
    expect(plan.blocked).toBe(false)
    expect(plan.errors).toEqual([])
    expect(plan.agents).toHaveLength(1)
    expect(plan.agents[0].workspaceMode).toBe('new')
    expect(plan.agents[0].newWorkspacePath.startsWith(await realpath(workspaces))).toBe(true)
    expect(plan.agents[0].mounts).toEqual(expect.arrayContaining([
      { source: realProject, target: { kind: 'legacy' }, readOnly: true },
      { source: realCredentials, target: { kind: 'home', path: '.config/opencode' }, readOnly: true },
    ]))
    expect(JSON.stringify(plan)).not.toContain('secret')
  })

  it('rejects a filesystem root as the source workspace', async () => {
    const { home, workspaces } = await fixture()
    const realHome = await realpath(home)
    const discovery = {
      home: realHome,
      services: [{
        id: 'running:opencode:123',
        kind: 'opencode',
        name: 'OpenCode',
        running: true,
        pid: 123,
        cwd: '/',
        ports: [],
        warnings: [],
        containerizable: false,
      }],
    }
    const plan = await buildMigrationPlan({
      discovery,
      managedWorkspaceRoot: workspaces,
      request: {
        agents: [{ id: 'running:opencode:123', sourceWorkspacePath: '/', workspaceMode: 'reuse' }],
      },
    })
    expect(plan.blocked).toBe(true)
    expect(plan.errors.some(error => /根目录/.test(error.message))).toBe(true)
  })

  it('rejects credential directories outside the user home', async () => {
    const { root, home, project, workspaces } = await fixture()
    const realHome = await realpath(home)
    const outside = join(root, 'outside-credentials')
    await mkdir(outside, { recursive: true })
    const discovery = {
      home: realHome,
      services: [{
        id: 'running:opencode:123',
        kind: 'opencode',
        name: 'OpenCode',
        running: true,
        pid: 123,
        cwd: await realpath(project),
        ports: [],
        warnings: [],
        containerizable: true,
      }],
    }
    const plan = await buildMigrationPlan({
      discovery,
      managedWorkspaceRoot: workspaces,
      request: {
        agents: [{
          id: 'running:opencode:123',
          sourceWorkspacePath: await realpath(project),
          workspaceMode: 'new',
          credentialPaths: [outside],
        }],
      },
    })
    expect(plan.blocked).toBe(true)
    expect(plan.errors.some(error => /用户主目录内/.test(error.message))).toBe(true)
  })
})
