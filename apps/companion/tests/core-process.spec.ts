import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { isAllowedCoreProcess, parseUnixSocketInode } from '../core-process.mjs'

describe('orphaned core process helpers', () => {
  it('finds a socket inode from /proc/net/unix', () => {
    const table = [
      '0000000000000000: 00000002 00000000 00010000 0001 01 12345 /run/user/1000/she/control.sock',
      '0000000000000000: 00000002 00000000 00010000 0001 01 54321 /run/user/1000/she/broker.sock',
    ].join('\n')
    expect(parseUnixSocketInode(table, '/run/user/1000/she/control.sock')).toBe('12345')
    expect(parseUnixSocketInode(table, '/missing.sock')).toBeUndefined()
  })

  it('only accepts verified SHE core command lines', () => {
    expect(isAllowedCoreProcess('node /home/user/.local/share/she/core/versions/0.2.2/control-plane.mjs')).toBe(true)
    expect(isAllowedCoreProcess('node /home/user/.local/share/she/core/versions/0.2.2/run-core.mjs')).toBe(true)
    expect(isAllowedCoreProcess('node /home/user/other-app/server.mjs')).toBe(false)
  })
})
