import { describe, expect, it } from 'vitest'

// @ts-expect-error dependency-free companion ESM helper
import {
  compareVersions,
  parseVersion,
  companionAssetUrls,
  resolveCompanionAssetUrl,
  resolveCompanionBundleUrl,
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

  it('uses absolute release asset URLs instead of the Pages channel directory', () => {
    const manifestUrl = 'https://pancong0711.github.io/she/companion-release-manifest.json'
    const manifest = {
      schema: 1,
      name: 'she-companion',
      version: '0.7.8',
      bundle: {
        file: 'she-companion-0.7.8.tar.gz',
        url: 'https://pancong0711.github.io/she/she-companion-0.7.8.tar.gz',
        fallbackUrl: 'https://github.com/pancong0711/she/releases/download/v0.7.8-companion.1/she-companion-0.7.8.tar.gz',
        sha256: 'a'.repeat(64),
      },
    }
    expect(resolveCompanionBundleUrl(manifestUrl, manifest)).toBe(manifest.bundle.url)
    expect(companionAssetUrls(manifestUrl, manifest.bundle)).toEqual([
      manifest.bundle.url,
      manifest.bundle.fallbackUrl,
    ])
    expect(resolveCompanionAssetUrl(manifestUrl, { file: 'fallback.tar.gz' })).toBe(
      'https://pancong0711.github.io/she/fallback.tar.gz',
    )
    expect(() => resolveCompanionAssetUrl(manifestUrl, { file: 'x', url: 'javascript:alert(1)' })).toThrow(/http/)
  })

  it('restricts update manifest URLs to SHE release downloads', () => {
    expect(validateCompanionManifestUrl('https://github.com/pancong0711/she/releases/download/v0.3.0-companion.1/companion-release-manifest.json'))
      .toContain('github.com/pancong0711/she')
    expect(validateCompanionManifestUrl('https://pancong0711.github.io/she/companion-release-manifest.json'))
      .toBe('https://pancong0711.github.io/she/companion-release-manifest.json')
    expect(() => validateCompanionManifestUrl('https://example.com/manifest.json')).toThrow(/github.com/)
    expect(() => validateCompanionManifestUrl('https://github.com/other/repo/releases/download/x/y')).toThrow(/SHE/)
  })
})
