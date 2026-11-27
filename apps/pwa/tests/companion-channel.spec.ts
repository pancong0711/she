import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readJson(url: URL): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(url, 'utf8')) as Record<string, unknown>
}

describe('companion release channel manifest', () => {
  it('stays in sync with the companion package and points at its release assets', async () => {
    const companion = await readJson(new URL('../../companion/package.json', import.meta.url))
    const manifest = await readJson(new URL('../public/companion-release-manifest.json', import.meta.url))
    const version = String(companion.version)
    const tag = `v${version}-companion.1`
    const bundle = manifest.bundle as { file?: string; url?: string; sha256?: string }
    const launcher = manifest.launcher as { file?: string; url?: string; sha256?: string }
    expect(manifest.version).toBe(version)
    expect(bundle.file).toBe(`she-companion-${version}.tar.gz`)
    expect(bundle.url).toBe(`https://github.com/pancong0711/she/releases/download/${tag}/she-companion-${version}.tar.gz`)
    expect(launcher.file).toBe('she-launcher.mjs')
    expect(launcher.url).toBe(`https://github.com/pancong0711/she/releases/download/${tag}/she-launcher.mjs`)
    expect(bundle.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(launcher.sha256).toMatch(/^[a-f0-9]{64}$/)
  })
})
