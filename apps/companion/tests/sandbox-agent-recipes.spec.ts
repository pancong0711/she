import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { SANDBOX_AGENT_RECIPES, sandboxAgentRecipeCatalog } from '../sandbox-agent-recipes.mjs'

describe('sandbox agent recipes', () => {
  it('provides pinned recipes for the supported agents', () => {
    expect(SANDBOX_AGENT_RECIPES.map(item => item.id).sort()).toEqual(['dsh', 'hermes', 'opencode', 'pi'])
    for (const item of SANDBOX_AGENT_RECIPES) {
      expect(item.packageName).not.toContain('latest')
      expect(item.version).toMatch(/^\d+\.\d+\.\d+/)
      expect(item.install.command[0]).toBe('sh')
      expect(item.install.command[1]).toBe('-lc')
      expect(item.install.command[2]).toContain('/home/agent/.local')
      expect(item.bootstrap.command[2]).toContain('exec sleep infinity')
    }
  })

  it('only exposes immutable catalog data', () => {
    const catalog = sandboxAgentRecipeCatalog()
    expect(catalog).toHaveLength(4)
    expect(JSON.stringify(catalog)).not.toContain('password')
  })
})
