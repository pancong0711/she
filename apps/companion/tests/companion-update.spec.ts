import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import {
  compareVersions,
  parseVersion,
  validateCompanionManifest,
  validateCompanionManifestUrl,
} from '../companion-update.mjs'

describe('companion update helpers', () => {
  it('parses and compares companion versions', () => {
    expect(parseVersion('v0.3.0')).toEqual([0, 3, 0])
    expect(compareVersions('0.2.1', '0.3.0')).toBe(-1)
    expect(compareVersions('0.3.0', '0.3.0')).toBe(0)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('bad', '0.3.0')).toBeUndefined()
  })

  it('validates release manifests', () => {
    const manifest = {
      schema: 1,
      name: 'she-companion',
      version: '0.3.0',
      bundle: { file: 'she-companion-0.3.0.tar.gz', sha256: 'a'.repeat(64) },
    }
    expect(validateCompanionManifest(manifest)).toBe(manifest)
    expect(() => validateCompanionManifest({ ...manifest, schema: 2 })).toThrow(/invalid/)
  })

  it('restricts update manifest URLs to SHE release downloads', () => {
    expect(validateCompanionManifestUrl('https://github.com/pancong0711/she/releases/download/v0.3.0-companion.1/companion-release-manifest.json'))
      .toContain('github.com/pancong0711/she')
    expect(() => validateCompanionManifestUrl('https://example.com/manifest.json')).toThrow(/github.com/)
    expect(() => validateCompanionManifestUrl('https://github.com/other/repo/releases/download/x/y')).toThrow(/SHE/)
  })
})
