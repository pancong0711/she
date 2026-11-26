import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import { FeishuGatewayManager, normalizeFeishuConfig, parseFeishuEnv } from '../feishu-gateway-manager.mjs'

describe('direct Feishu gateway manager', () => {
  it('writes a 0600 env file and preserves the secret when it is left blank', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'she-feishu-gateway-'))
    const envFile = join(dir, 'feishu.env')
    const manager = new FeishuGatewayManager({
      envFile,
      entry: join(dir, 'missing.mjs'),
      controlSocket: join(dir, 'control.sock'),
      tokenFile: join(dir, 'token'),
      env: {},
    })
    await manager.save({
      appId: 'cli_test',
      appSecret: 'super-secret',
      domain: 'feishu',
      requireMention: true,
      allowedOpenIds: 'ou_1, ou_2',
    })
    expect((await stat(envFile)).mode & 0o777).toBe(0o600)
    let status = await manager.status()
    expect(status.envFile).toMatchObject({
      exists: true,
      mode: 0o600,
      appIdConfigured: true,
      appSecretConfigured: true,
      domain: 'feishu',
      requireMention: true,
    })
    expect(JSON.stringify(status)).not.toContain('super-secret')

    await manager.save({ appId: 'cli_test', appSecret: '', domain: 'lark', requireMention: false })
    const parsed = parseFeishuEnv(await readFile(envFile, 'utf8'))
    expect(parsed.FEISHU_APP_SECRET).toBe('super-secret')
    expect(parsed.FEISHU_DOMAIN).toBe('lark')
    expect(parsed.FEISHU_REQUIRE_MENTION).toBe('0')
    status = await manager.status()
    expect(status.runtime.running).toBe(false)
  })

  it('validates app credentials and allowlists', () => {
    expect(() => normalizeFeishuConfig({ appId: 'bad', appSecret: 'x' })).toThrow(/cli_/)
    expect(() => normalizeFeishuConfig({ appId: 'cli_ok', appSecret: '' })).toThrow(/App Secret/)
    expect(normalizeFeishuConfig({ appId: 'cli_ok', appSecret: '' }, { FEISHU_APP_SECRET: 'old' })).toMatchObject({
      FEISHU_APP_ID: 'cli_ok',
      FEISHU_APP_SECRET: 'old',
      FEISHU_REQUIRE_MENTION: '0',
    })
  })
})
