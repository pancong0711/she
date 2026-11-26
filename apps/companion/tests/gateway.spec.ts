import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { validateGatewayConfig, validateGatewayHealthUrl } from '../gateway.mjs'

describe('gateway config safety', () => {
  it('only allows loopback adapter health URLs', () => {
    expect(validateGatewayHealthUrl('http://127.0.0.1:9090/health')).toContain('127.0.0.1')
    expect(validateGatewayHealthUrl('http://localhost:9090/health')).toContain('localhost')
    expect(() => validateGatewayHealthUrl('https://example.com/health')).toThrow(/loopback/)
    expect(() => validateGatewayHealthUrl('http://user:pass@127.0.0.1/health')).toThrow(/credentials/)
  })

  it('enforces the external secret boundary and requires a URL when enabled', () => {
    const config = validateGatewayConfig({ enabled: true, adapterHealthUrl: 'http://127.0.0.1:9090/health', token: 'must-not-be-stored' })
    expect(config).toEqual({
      schema: 1,
      channel: 'feishu4dsh',
      enabled: true,
      adapterHealthUrl: 'http://127.0.0.1:9090/health',
      secretBoundary: 'external-only',
    })
    expect(JSON.stringify(config)).not.toContain('must-not-be-stored')
    expect(() => validateGatewayConfig({ enabled: true, adapterHealthUrl: '' })).toThrow(/health URL/)
  })
})
