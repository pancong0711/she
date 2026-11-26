/**
 * Parse a user-entered container command into argv tokens.
 *
 * The broker executes the resulting array without a host shell. A shell must
 * therefore be requested explicitly (`sh -lc "..."`). This parser intentionally
 * supports only quoting and backslash escaping; it does not expand variables,
 * globs, pipes, redirects or command substitutions on the host.
 */
export function parseCommandLine(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  let tokenStarted = false

  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      tokenStarted = true
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      tokenStarted = true
      continue
    }
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
      tokenStarted = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      tokenStarted = true
      continue
    }
    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current)
        current = ''
        tokenStarted = false
      }
      continue
    }
    current += char
    tokenStarted = true
  }

  if (escaped) throw new Error('启动命令末尾存在未完成的转义符')
  if (quote !== null) throw new Error('启动命令存在未闭合的引号')
  if (tokenStarted) tokens.push(current)
  return tokens
}
