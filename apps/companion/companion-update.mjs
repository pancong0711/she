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
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.bundle?.sha256 ?? ''))) throw new Error('companion manifest bundle.sha256 is invalid')
  return manifest
}

export function validateCompanionManifestUrl(value) {
  const text = String(value ?? '').trim()
  if (text.startsWith('file://')) return text
  let url
  try { url = new URL(text) } catch { throw new Error('companion manifest URL is invalid') }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('companion manifest URL must be an https://github.com release URL')
  }
  if (!url.pathname.startsWith('/pancong0711/she/releases/download/')) {
    throw new Error('companion manifest URL must point to the SHE GitHub release downloads')
  }
  return text
}
