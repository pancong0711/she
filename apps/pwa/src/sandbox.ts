/** Pure helpers for sandbox creation form state. */

import { parseCommandLine } from './command'

/** Old UI-only placeholder that must never be sent to Docker as a command. */
export const SANDBOX_RECIPE_PLACEHOLDER = '由 Agent recipe 在容器启动时安装并保持运行'

export interface SandboxRecipeCommandSource {
  readonly bootstrap: {
    readonly command: readonly string[]
  }
}

/**
 * Resolve the actual Docker command for a new sandbox.
 *
 * Agent recipes always use their pinned bootstrap command. This prevents stale
 * UI placeholder text from being passed to `docker run` after the recipe
 * selection changes or the recipe catalog fails to load.
 */
export function sandboxCommandForCreate(
  recipe: SandboxRecipeCommandSource | undefined,
  commandText: string,
): readonly string[] | undefined {
  if (recipe !== undefined) return [...recipe.bootstrap.command]
  const text = String(commandText ?? '').trim()
  if (text === '' || text === SANDBOX_RECIPE_PLACEHOLDER) return parseCommandLine('sleep infinity')
  return parseCommandLine(text)
}
