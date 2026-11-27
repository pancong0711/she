/** Pure helpers for page-driven companion update checks. */

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value ?? '').trim())
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return undefined
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

export function validateCompanionManifest(manifest) {
  if (manifest?.schema !== 1 || manifest?.name !== 'she-companion') throw new Error('invalid companion manifest')
  if (parseVersion(manifest.version) === undefined) throw new Error('companion manifest version is invalid')
  if (typeof manifest.bundle?.file !== 'string' || manifest.bundle.file.trim() === '') throw new Error('companion manifest bundle.file is missing')
  if (manifest.bundle.url !== undefined && (typeof manifest.bundle.url !== 'string' || manifest.bundle.url.trim() === '')) {
    throw new Error('companion manifest bundle.url is invalid')
  }
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.bundle?.sha256 ?? ''))) throw new Error('companion manifest bundle.sha256 is invalid')
  return manifest
}

/**
 * Resolve one release asset URL.
 *
 * The stable Pages channel manifest intentionally carries absolute release URLs
 * because its own directory does not host the companion bundle. Older manifests
 * may omit `url`; in that case keep the historical relative-to-manifest fallback.
 */
export function resolveCompanionAssetUrl(manifestUrl, asset, label = 'asset') {
  if (typeof asset?.file !== 'string' || asset.file.trim() === '') throw new Error(`companion manifest ${label}.file is missing`)
  const declared = typeof asset.url === 'string' ? asset.url.trim() : ''
  let url
  try {
    url = new URL(declared === '' ? asset.file : declared, manifestUrl)
  } catch {
    throw new Error(`companion manifest ${label}.url is invalid`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'file:') {
    throw new Error(`companion manifest ${label}.url must use http(s) or file://`)
  }
  return url.href
}

export function resolveCompanionBundleUrl(manifestUrl, manifest) {
  return resolveCompanionAssetUrl(manifestUrl, manifest?.bundle, 'bundle')
}

export function resolveCompanionLauncherUrl(manifestUrl, manifest) {
  return resolveCompanionAssetUrl(manifestUrl, manifest?.launcher, 'launcher')
}

const SHE_COMPANION_CHANNEL_MANIFEST = 'https://pancong0711.github.io/she/companion-release-manifest.json'

export function validateCompanionManifestUrl(value) {
  const text = String(value ?? '').trim()
  if (text.startsWith('file://')) return text
  // The stable companion channel lives on GitHub Pages so core/packages
  // releases cannot steal the repository-level GitHub "latest" pointer.
  if (text === SHE_COMPANION_CHANNEL_MANIFEST) return text
  let url
  try { url = new URL(text) } catch { throw new Error('companion manifest URL is invalid') }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('companion manifest URL must be the SHE Pages channel or an https://github.com release URL')
  }
  if (!url.pathname.startsWith('/pancong0711/she/releases/download/')) {
    throw new Error('companion manifest URL must point to the SHE GitHub release downloads')
  }
  return text
}
