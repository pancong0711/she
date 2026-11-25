import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenCodeAgentAdapter, OpenCodeClient, OpenCodeError } from '@she/agent-opencode'
import type { AgentEventEnvelope } from '@she/protocol'

type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void
const cleanup: (() => Promise<void>)[] = []

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

async function startServer(handler: Handler): Promise<string> {
  const server = createServer((request, response) => {
    void readBody(request).then(body => handler(request, response, body))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no test address')
  cleanup.push(async () => {
    server.close()
    await once(server, 'close').catch(() => undefined)
  })
  return `http://127.0.0.1:${address.port}`
}

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'she-opencode-'))
  cleanup.push(async () => rm(dir, { recursive: true, force: true }))
  return dir
}

function json(response: ServerResponse, payload: unknown, status = 200): void {
  const text = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  response.end(text)
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

async function collect(iterable: AsyncIterable<AgentEventEnvelope>): Promise<AgentEventEnvelope[]> {
  const events: AgentEventEnvelope[] = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('OpenCodeAgentAdapter', () => {
  it('creates a session with model/permissions and maps async prompt polling to events', async () => {
    let createBody: unknown
    let prompted = false
    const baseUrl = await startServer((request, response, body) => {
      if (request.url === '/api/info') {
        json(response, { version: '2.3.2' })
        return
      }
      if (request.url === '/api/session' && request.method === 'POST') {
        createBody = JSON.parse(body)
        json(response, { data: { id: 'ses-1' } })
        return
      }
      if (request.url === '/api/session/ses-1/prompt' && request.method === 'POST') {
        prompted = true
        json(response, { data: { id: 'msg-1' } })
        return
      }
      if (request.url === '/api/session/active') {
        json(response, { data: {} })
        return
      }
      if (request.url === '/api/session/ses-1/message?limit=20&order=desc') {
        json(response, { data: [{ type: 'assistant', content: [{ type: 'text', text: 'done' }] }] })
        return
      }
      if (request.url === '/api/session/ses-1') {
        json(response, { data: { id: 'ses-1', ...(prompted ? { outcome: 'succeeded' } : {}) } })
        return
      }
      json(response, { message: 'not found' }, 404)
    })
    const dir = await workspace()
    const adapter = new OpenCodeAgentAdapter({
      baseUrl,
      username: 'opencode',
      credential: 'test-password',
      pollIntervalMs: 1,
      promptTimeoutMs: 1_000,
    })
    expect(await adapter.health()).toMatchObject({ ok: true, version: '2.3.2' })
    const session = await adapter.createSession({
      adapterId: 'opencode',
      sessionKey: 'topic-1',
      workspace: { key: 'workspace-1', path: dir },
      model: { providerId: 'opencode-go', modelId: 'deepseek-v4.1-flash', variant: 'high' },
      metadata: { title: 'SHE 1 test' },
    })
    expect(session.sessionId).toBe('ses-1')
    expect(createBody).toMatchObject({
      title: 'SHE 1 test',
      model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash', variant: 'high' },
      location: { directory: dir },
    })
    expect((createBody as { permissions: { action: string; resource: string; effect: string }[] }).permissions)
      .toContainEqual({ action: 'shell', resource: '*git commit*', effect: 'deny' })

    const events = await collect(adapter.prompt({
      promptId: 'prompt-1',
      sessionId: 'ses-1',
      text: 'implement it',
    }))
    expect(events.map(event => event.event.kind)).toEqual(['text-delta', 'turn-end'])
    expect(events[0]?.event).toMatchObject({ kind: 'text-delta', text: 'done' })
    expect(events[1]?.event).toMatchObject({ kind: 'turn-end', reason: 'completed' })
  })

  it('checks the report file path and size after successful completion', async () => {
    let prompted = false
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/api/session' && request.method === 'POST') {
        json(response, { data: { id: 'ses-report' } })
        return
      }
      if (request.url === '/api/session/ses-report/prompt') {
        prompted = true
        json(response, { data: { id: 'msg-report' } })
        return
      }
      if (request.url === '/api/session/active') {
        json(response, { data: {} })
        return
      }
      if (request.url?.startsWith('/api/session/ses-report/message')) {
        json(response, { data: [{ type: 'assistant', content: [{ type: 'text', text: 'report ready' }] }] })
        return
      }
      if (request.url === '/api/session/ses-report') {
        json(response, { data: { id: 'ses-report', ...(prompted ? { outcome: 'succeeded' } : {}) } })
        return
      }
      json(response, { message: 'not found' }, 404)
    })
    const dir = await workspace()
    const adapter = new OpenCodeAgentAdapter({ baseUrl, username: 'opencode', credential: 'pw', pollIntervalMs: 1 })
    await adapter.createSession({
      adapterId: 'opencode',
      sessionKey: 'topic-report',
      workspace: { key: 'workspace-1', path: dir },
    })
    const reportPath = join(dir, 'report.md')
    await writeFile(reportPath, '# report\n', 'utf8')
    const okEvents = await collect(adapter.prompt({
      promptId: 'prompt-report',
      sessionId: 'ses-report',
      text: 'write report',
      metadata: { reportPath },
    }))
    expect(okEvents.at(-1)?.event).toMatchObject({ kind: 'turn-end', reason: 'completed' })

    const missingPath = join(dir, 'missing.md')
    const missingEvents = await collect(adapter.prompt({
      promptId: 'prompt-missing',
      sessionId: 'ses-report',
      text: 'write missing report',
      metadata: { reportPath: missingPath },
    }))
    expect(missingEvents.map(event => event.event.kind)).toEqual(['text-delta', 'error', 'turn-end'])
    expect(missingEvents[1]?.event).toMatchObject({
      kind: 'error',
      error: { code: 'report_missing' },
    })
  })

  it('maps unauthorized and unreachable errors to stable codes', async () => {
    const baseUrl = await startServer((_request, response) => {
      json(response, { message: 'auth required' }, 401)
    })
    const client = new OpenCodeClient({ baseUrl, username: 'opencode', credential: 'bad' })
    await expect(client.info()).rejects.toMatchObject({ code: 'unauthorized' })
    const adapter = new OpenCodeAgentAdapter({ baseUrl, username: 'opencode', credential: 'bad' })
    expect(await adapter.health()).toMatchObject({ ok: false })
    await expect(client.getSession('missing')).rejects.toBeInstanceOf(OpenCodeError)
  })
})
