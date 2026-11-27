import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'

const children: ReturnType<typeof spawn>[] = []

function freePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer()
    probe.once('error', rejectPromise)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close()
        rejectPromise(new Error('cannot allocate test port'))
        return
      }
      const port = address.port
      probe.close(error => error === undefined ? resolvePromise(port) : rejectPromise(error))
    })
  })
}

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGTERM')
})

describe('companion cross-origin API', () => {
  it('answers CORS preflight with the headers used by GitHub Pages', async () => {
    const port = await freePort()
    const child = spawn(process.execPath, ['apps/companion/server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SHE_PWA_PORT: String(port),
        SHE_CONTROL_SOCKET: '/tmp/she-test-missing-control.sock',
        SHE_BROKER_SOCKET: '/tmp/she-test-missing-broker.sock',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const lines = createInterface({ input: child.stdout! })
      const timer = setTimeout(() => rejectPromise(new Error('companion did not start')), 10_000)
      lines.on('line', line => {
        if (line.includes('she-pwa listening')) {
          clearTimeout(timer)
          resolvePromise()
        }
      })
      child.once('exit', code => {
        clearTimeout(timer)
        rejectPromise(new Error(`companion exited before startup: ${String(code)}`))
      })
    })

    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://pancong0711.github.io',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'accept,cache-control',
        'access-control-request-private-network': 'true',
      },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://pancong0711.github.io')
    expect(response.headers.get('access-control-allow-headers')).toContain('cache-control')
    expect(response.headers.get('access-control-allow-private-network')).toBe('true')

    for (const path of ['/v1/health', '/broker/v1/health']) {
      const proxyError = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { origin: 'https://pancong0711.github.io', accept: 'application/json' },
      })
      expect(proxyError.status).toBe(503)
      expect(proxyError.headers.get('access-control-allow-origin')).toBe('https://pancong0711.github.io')
    }
  })
})
