import { describe, expect, it } from 'vitest'
import {
  InvalidTaskTransitionError,
  assertTaskTransition,
  canTransitionTask,
  canTransitionTopic,
  transitionTask,
  transitionTopic,
  type Task,
  type Topic,
} from '@she/core'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    topicId: 'topic-1',
    seq: 1,
    status: 'queued',
    priority: 'interactive',
    risk: 'workspace-write',
    requestHash: 'hash',
    requestExcerpt: 'request',
    idempotencyKey: null,
    attachments: [],
    agentSessionId: null,
    sandboxName: null,
    reportArtifactId: null,
    error: null,
    createdAt: 100,
    updatedAt: 100,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

function topic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-1',
    conversationKey: 'conversation-1',
    displayNo: '1',
    title: 'Topic',
    workspaceKey: 'workspace-1',
    status: 'active',
    activeTaskId: null,
    createdAt: 100,
    updatedAt: 100,
    lastActiveAt: 100,
    ...overrides,
  }
}

describe('task state machine', () => {
  it('walks the happy path and stamps timestamps', () => {
    const queued = task()
    const dispatching = transitionTask(queued, 'dispatching', 101)
    const submitted = transitionTask(dispatching, 'submitted', 102, { agentSessionId: 'session-1' })
    const running = transitionTask(submitted, 'running', 103)
    const succeeded = transitionTask(running, 'succeeded', 104, { reportArtifactId: 'artifact-1' })

    expect(submitted.agentSessionId).toBe('session-1')
    expect(submitted.startedAt).toBe(102)
    expect(running.startedAt).toBe(102)
    expect(succeeded.finishedAt).toBe(104)
    expect(succeeded.reportArtifactId).toBe('artifact-1')
  })

  it('rejects invalid transitions and terminal writes', () => {
    expect(canTransitionTask('queued', 'succeeded')).toBe(false)
    expect(() => assertTaskTransition('queued', 'succeeded')).toThrow(InvalidTaskTransitionError)
    expect(() => transitionTask(task({ status: 'cancelled' }), 'queued', 102)).toThrow(
      InvalidTaskTransitionError,
    )
  })
})

describe('topic state machine', () => {
  it('allows pause, resume and archive', () => {
    expect(canTransitionTopic('active', 'paused')).toBe(true)
    expect(canTransitionTopic('paused', 'active')).toBe(true)
    expect(canTransitionTopic('archived', 'active')).toBe(true)
    expect(canTransitionTopic('active', 'active')).toBe(false)
  })

  it('updates activity and optional fields', () => {
    const paused = transitionTopic(topic(), 'paused', 200, { activeTaskId: 'task-1' })
    expect(paused.status).toBe('paused')
    expect(paused.activeTaskId).toBe('task-1')
    expect(paused.updatedAt).toBe(200)
  })
})
