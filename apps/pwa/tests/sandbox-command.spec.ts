import { describe, expect, it } from 'vitest'
import { SANDBOX_RECIPE_PLACEHOLDER, sandboxBootstrapPollAttempts, sandboxCommandForCreate } from '../src/sandbox'

describe('sandbox create command resolution', () => {
  it('uses the recipe bootstrap command instead of UI state', () => {
    const command = sandboxCommandForCreate(
      { bootstrap: { command: ['sh', '-lc', 'npm install && exec sleep infinity'] } },
      SANDBOX_RECIPE_PLACEHOLDER,
    )
    expect(command).toEqual(['sh', '-lc', 'npm install && exec sleep infinity'])
  })

  it('never sends the legacy recipe placeholder as a Docker command', () => {
    expect(sandboxCommandForCreate(undefined, SANDBOX_RECIPE_PLACEHOLDER)).toEqual(['sleep', 'infinity'])
  })

  it('parses a normal user command', () => {
    expect(sandboxCommandForCreate(undefined, 'sh -lc "echo ok"')).toEqual(['sh', '-lc', 'echo ok'])
  })
})

  it('polls long-running agent installs for the full recipe timeout', () => {
    expect(sandboxBootstrapPollAttempts(300_000)).toBe(72)
    expect(sandboxBootstrapPollAttempts(30_000)).toBe(18)
  })
