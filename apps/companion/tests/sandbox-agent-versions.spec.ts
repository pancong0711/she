import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { recordAgentInstall, resolveSandboxAgentVersion } from '../sandbox-agent-versions.mjs'

function fakeFetch(versions: string[], latest: string) {
  return async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        versions: Object.fromEntries(versions.map(version => [version, { version }])),
        'dist-tags': { latest },
      }
    },
  })
}

describe('sandbox agent version resolution', () => {
  it('accepts an exact requested version', async () => {
    const result = await resolveSandboxAgentVersion('opencode', '0.2.4', {
      fetchImpl: fakeFetch(['0.2.3', '0.2.4', '1.19.6'], '1.19.6'),
    })
    expect(result).toMatchObject({ requested: '0.2.4', resolved: '0.2.4', exact: true, fallback: false, verified: true })
    expect(result.recipe.version).toBe('0.2.4')
    expect(result.recipe.install.command[2]).toContain('opencode-ai@0.2.4')
  })

  it('falls back to the latest stable version when the request is missing', async () => {
    const result = await resolveSandboxAgentVersion('opencode', '9.9.9', {
      fetchImpl: fakeFetch(['0.2.4', '1.19.6'], '1.19.6'),
    })
    expect(result).toMatchObject({ requested: '9.9.9', resolved: '1.19.6', exact: false, fallback: true, verified: true })
    expect(result.warning).toContain('不存在')
  })

  it('retains only the five most recent successful versions per agent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'she-agent-versions-'))
    const path = join(dir, 'agent-versions.json')
    for (let index = 0; index < 7; index += 1) {
      await recordAgentInstall(path, {
        agentId: 'opencode',
        version: `1.0.${index}`,
        success: true,
        sandboxName: `sbx-${index}`,
      }, 1_000 + index)
    }
    const registry = JSON.parse(await readFile(path, 'utf8'))
    expect(registry.agents.opencode.versions).toHaveLength(5)
    expect(registry.agents.opencode.versions.map((item: { version: string }) => item.version)).toEqual([
      '1.0.6', '1.0.5', '1.0.4', '1.0.3', '1.0.2',
    ])
    expect(JSON.stringify(registry)).not.toContain('secret')
  })
})
