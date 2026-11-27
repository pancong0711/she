import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { CORS_ALLOWED_REQUEST_HEADERS, CORS_EXPOSED_RESPONSE_HEADERS, corsHeadersForOrigin } from '../cors.mjs'

const origins = new Set(['https://pancong0711.github.io', 'http://127.0.0.1:8787'])

describe('companion CORS headers', () => {
  it('allows the headers used by cross-origin PWA reads and writes', () => {
    const headers = corsHeadersForOrigin('https://pancong0711.github.io', origins)
    expect(headers).toMatchObject({
      'access-control-allow-origin': 'https://pancong0711.github.io',
      'access-control-allow-private-network': 'true',
      vary: 'Origin',
    })
    expect(CORS_ALLOWED_REQUEST_HEADERS).toContain('cache-control')
    expect(CORS_ALLOWED_REQUEST_HEADERS).toContain('x-she-local-action')
    expect(CORS_ALLOWED_REQUEST_HEADERS).toContain('content-type')
    expect(CORS_EXPOSED_RESPONSE_HEADERS).toContain('content-disposition')
  })

  it('rejects unknown origins and leaves local non-browser requests alone', () => {
    expect(corsHeadersForOrigin('https://example.com', origins)).toBeUndefined()
    expect(corsHeadersForOrigin(undefined, origins)).toEqual({})
  })
})
