import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenCodeAgentAdapter } from '@she/agent-opencode'
import {
  InMemoryArtifactRepository,
  InMemoryEventStore,
  InMemoryLeaseRepository,
  InMemoryTaskRepository,
  InMemoryTaskRequestStore,
  InMemoryTopicRepository,
  SequentialIdGenerator,
  TaskRunner,
  TaskService,
} from '@she/control'

const cleanup: (() => Promise<void>)[] = []

async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  cleanup.push(async () => {
    server.close()
    await once(server, 'close').catch(() => undefined)
  })
  return `http://127.0.0.1:${address.port}`
}

function json(response: ServerResponse, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(run => run()))
})

describe('OpenCode adapter + TaskRunner integration', () => {
  it('runs a task through the OpenCode HTTP adapter to succeeded', async () => {
    let prompted = false
    const baseUrl = await startServer((request, response) => {
      if (request.url === '/api/info') {
        json(response, { version: '2.3.2' })
        return
      }
      if (request.url === '/api/session' && request.method === 'POST') {
        json(response, { data: { id: 'ses-integration' } })
        return
      }
      if (request.url === '/api/session/ses-integration/prompt') {
        prompted = true
        json(response, { data: { id: 'msg-integration' } })
        return
      }
      if (request.url === '/api/session/active') {
        json(response, { data: {} })
        return
      }
      if (request.url?.startsWith('/api/session/ses-integration/message')) {
        json(response, { data: [{ type: 'assistant', content: [{ type: 'text', text: 'task complete' }] }] })
        return
      }
      if (request.url === '/api/session/ses-integration') {
        json(response, { data: { id: 'ses-integration', ...(prompted ? { outcome: 'succeeded' } : {}) } })
        return
      }
      json(response, { message: 'not found' })
    })
    const workspace = await mkdtemp(join(tmpdir(), 'she-opencode-int-'))
    cleanup.push(async () => rm(workspace, { recursive: true, force: true }))

    const clock = { now: () => Date.now() }
    const events = new InMemoryEventStore()
    const topics = new InMemoryTopicRepository()
    const tasks = new InMemoryTaskRepository()
    const requests = new InMemoryTaskRequestStore()
    const deps = {
      clock,
      ids: new SequentialIdGenerator(),
      topics,
      tasks,
      artifacts: new InMemoryArtifactRepository(),
      requests,
      events,
      leases: new InMemoryLeaseRepository(),
    }
    const service = new TaskService(deps)
    const runner = new TaskRunner({
      ...deps,
      agent: new OpenCodeAgentAdapter({
        baseUrl,
        username: 'opencode',
        credential: 'integration-password',
        pollIntervalMs: 1,
        promptTimeoutMs: 2_000,
      }),
    }, { defaultLeaseTtlMs: 10_000 })

    const submitted = await service.submit({
      conversationKey: 'chat-integration',
      workspaceKey: 'workspace-integration',
      request: 'implement the integration',
    })
    const result = await runner.runNext({
      topicId: submitted.topic.id,
      ownerId: 'worker-integration',
      workspacePath: workspace,
    })
    expect(result?.finalStatus).toBe('succeeded')
    expect(result?.task.agentSessionId).toBe('ses-integration')
    expect(result?.agentEvents.map(event => event.event.kind)).toEqual(['text-delta', 'turn-end'])
    expect((await tasks.get(submitted.task.id))?.status).toBe('succeeded')
    expect(await requests.get(submitted.task.id)).toBeUndefined()
  })
})
