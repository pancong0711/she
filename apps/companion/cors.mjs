/** CORS and Private Network Access headers for the loopback companion API. */

export const CORS_ALLOWED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'cache-control',
  'pragma',
  'x-she-local-action',
].join(', ')

export const CORS_EXPOSED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
].join(', ')

/**
 * Return CORS headers for an allowed browser origin.
 *
 * `undefined` means the origin is explicitly configured but not allowlisted.
 * A missing Origin header is a non-browser/local request and needs no CORS.
 */
export function corsHeadersForOrigin(origin, allowedOrigins) {
  if (origin === undefined) return {}
  if (!allowedOrigins.has(origin)) return undefined
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': CORS_ALLOWED_REQUEST_HEADERS,
    'access-control-expose-headers': CORS_EXPOSED_RESPONSE_HEADERS,
    'access-control-max-age': '600',
    // Chrome/Edge Private Network Access: public HTTPS page -> loopback HTTP.
    'access-control-allow-private-network': 'true',
    vary: 'Origin',
  }
}
