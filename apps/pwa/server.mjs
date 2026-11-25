#!/usr/bin/env node
/**
 * Local-only PWA host for SHE.
 *
 * Serves the built Vite app from apps/pwa/dist and proxies /v1/* to the
 * control-plane Unix socket. It binds 127.0.0.1 only. The browser never sees
 * the optional bearer token; this process reads it from a local file.
 */

import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { homedir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, 'dist')
const host = '127.0.0.1'
const port = Number(process.env.SHE_PWA_PORT ?? 8787)
const socketPath = process.env.SHE_CONTROL_SOCKET?.trim()
  || join(process.env.XDG_RUNTIME_DIR?.trim() || join(homedir(), '.local', 'run'), 'she', 'control.sock')
const tokenFile = process.env.SHE_TOKEN_FILE?.trim()
  || join(process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config'), 'she', 'token')
const allowedOrigins = new Set(
  (process.env.SHE_ALLOWED_ORIGINS
    ?? 'https://pancong0711.github.io,http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
)

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
])

async function readToken() {
  try {
    const value = (await readFile(tokenFile, 'utf8')).trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

function securityHeaders(response, contentType) {
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-frame-options', 'DENY')
  response.setHeader(
    'content-security-policy',
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; manifest-src 'self'; worker-src 'self' blob:",
  )
  if (contentType !== undefined) response.setHeader('content-type', contentType)
}

function corsHeaders(request) {
  const origin = request.headers.origin
  if (origin === undefined) return {}
  if (!allowedOrigins.has(origin)) return undefined
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, accept',
    'access-control-expose-headers': 'content-type',
    'access-control-max-age': '600',
    'access-control-allow-private-network': 'true',
    vary: 'Origin',
  }
}

async function proxyApi(request, response) {
  const cors = corsHeaders(request)
  if (cors === undefined) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({
      ok: false,
      error: { code: 'forbidden', message: 'origin is not allowed to access the SHE companion', retryable: false },
    }))
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    response.end()
    return
  }
  const token = await readToken()
  const headers = { ...request.headers }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  delete headers.host

  const proxy = httpRequest({
    socketPath,
    path: request.url,
    method: request.method,
    headers,
  }, upstream => {
    response.writeHead(upstream.statusCode ?? 502, { ...upstream.headers, ...cors })
    upstream.pipe(response)
  })
  proxy.on('error', error => {
    if (response.headersSent) {
      response.destroy()
      return
    }
    const body = JSON.stringify({
      ok: false,
      error: {
        code: 'unavailable',
        message: `SHE control plane unavailable: ${error.message}`,
        retryable: true,
        details: { socketPath },
      },
    })
    response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
    response.end(body)
  })
  request.pipe(proxy)
}

async function serveStatic(request, response) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    response.writeHead(400)
    response.end('bad request')
    return
  }
  const candidate = resolve(distDir, `.${pathname}`)
  const rel = relative(distDir, candidate)
  if (rel.startsWith('..') || rel.includes('..')) {
    response.writeHead(403)
    response.end('forbidden')
    return
  }
  let file = candidate
  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
  } catch {
    if (extname(pathname) === '') file = join(distDir, 'index.html')
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const contentType = mime.get(extname(file)) ?? 'application/octet-stream'
    securityHeaders(response, contentType)
    response.setHeader('cache-control', file.endsWith('index.html') || file.endsWith('sw.js')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable')
    response.writeHead(200)
    createReadStream(file).pipe(response)
  } catch {
    if ((await stat(join(distDir, 'index.html')).catch(() => undefined)) === undefined) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('SHE PWA is not built. Run: pnpm pwa:build')
      return
    }
    securityHeaders(response, 'text/html; charset=utf-8')
    response.writeHead(200)
    createReadStream(join(distDir, 'index.html')).pipe(response)
  }
}

const server = createServer((request, response) => {
  if ((request.url ?? '').startsWith('/v1/')) {
    void proxyApi(request, response)
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }
  void serveStatic(request, response)
})

server.listen(port, host, () => {
  process.stdout.write(`she-pwa listening on http://${host}:${String(port)}\n`)
  process.stdout.write(`control-plane socket: ${socketPath}\n`)
  process.stdout.write(`serving: ${distDir}\n`)
  process.stdout.write(`allowed browser origins: ${[...allowedOrigins].join(', ')}\n`)
})

const shutdown = () => server.close(() => process.exit(0))
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
