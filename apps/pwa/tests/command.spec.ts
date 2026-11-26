import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../src/command'

describe('parseCommandLine', () => {
  it('preserves quoted shell commands as one argv element', () => {
    expect(parseCommandLine(`sh -lc 'exec node server.js --flag "x y"'`)).toEqual([
      'sh',
      '-lc',
      'exec node server.js --flag "x y"',
    ])
  })

  it('supports escaping outside single quotes', () => {
    expect(parseCommandLine('sleep 1\\ 2')).toEqual(['sleep', '1 2'])
    expect(parseCommandLine('echo "a\\"b"')).toEqual(['echo', 'a"b'])
  })

  it('rejects unterminated quotes', () => {
    expect(() => parseCommandLine(`sh -lc "echo hello`)).toThrow(/引号/)
  })
})
