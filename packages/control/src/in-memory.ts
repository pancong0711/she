/** In-memory repository/event-store implementations for pure control-plane tests. */

import type {
  Artifact,
  ArtifactRepository,
  EventPage,
  EventStore,
  SheDomainEvent,
  StoredEvent,
  Task,
  TaskLease,
  LeaseRepository,
  TaskRequestStore,
  TaskRepository,
  Topic,
  TopicRepository,
} from '@she/core'
import { eventCursor, parseEventCursor } from '@she/core'

export class InMemoryTopicRepository implements TopicRepository {
  private readonly topics = new Map<string, Topic>()

  async get(id: string): Promise<Topic | undefined> {
    return this.topics.get(id)
  }

  async findActiveByConversation(conversationKey: string): Promise<Topic | undefined> {
    return [...this.topics.values()]
      .filter(topic => topic.conversationKey === conversationKey && topic.status === 'active')
      .sort((left, right) => right.createdAt - left.createdAt)[0]
  }

  async listByConversation(conversationKey: string): Promise<readonly Topic[]> {
    return [...this.topics.values()]
      .filter(topic => topic.conversationKey === conversationKey)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  async nextDisplayNo(conversationKey: string): Promise<string> {
    const topics = await this.listByConversation(conversationKey)
    const max = topics.reduce((current, topic) => {
      const value = Number(topic.displayNo)
      return Number.isSafeInteger(value) ? Math.max(current, value) : current
    }, 0)
    return String(max + 1)
  }

  async save(topic: Topic): Promise<void> {
    this.topics.set(topic.id, topic)
  }
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, Task>()

  async get(id: string): Promise<Task | undefined> {
    return this.tasks.get(id)
  }

  async findByIdempotencyKey(key: string): Promise<Task | undefined> {
    return [...this.tasks.values()].find(task => task.idempotencyKey === key)
  }

  async listByTopic(topicId: string): Promise<readonly Task[]> {
    return [...this.tasks.values()]
      .filter(task => task.topicId === topicId)
      .sort((left, right) => left.seq - right.seq)
  }

  async nextSeq(topicId: string): Promise<number> {
    const tasks = await this.listByTopic(topicId)
    return tasks.reduce((max, task) => Math.max(max, task.seq), 0) + 1
  }

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, task)
  }
}

export class InMemoryArtifactRepository implements ArtifactRepository {
  private readonly artifacts = new Map<string, Artifact>()

  async get(id: string): Promise<Artifact | undefined> {
    return this.artifacts.get(id)
  }

  async listByTask(taskId: string): Promise<readonly Artifact[]> {
    return [...this.artifacts.values()]
      .filter(artifact => artifact.taskId === taskId)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  async save(artifact: Artifact): Promise<void> {
    this.artifacts.set(artifact.id, artifact)
  }
}

export class InMemoryEventStore implements EventStore {
  private sequence = 0
  private readonly byId = new Map<string, StoredEvent<SheDomainEvent>>()
  private readonly ordered: StoredEvent<SheDomainEvent>[] = []

  async append(events: readonly SheDomainEvent[]): Promise<readonly StoredEvent<SheDomainEvent>[]> {
    const stored: StoredEvent<SheDomainEvent>[] = []
    for (const event of events) {
      const existing = this.byId.get(event.eventId)
      if (existing !== undefined) {
        stored.push(existing)
        continue
      }
      this.sequence += 1
      const item: StoredEvent<SheDomainEvent> = {
        cursor: eventCursor(this.sequence),
        sequence: this.sequence,
        event,
      }
      this.byId.set(event.eventId, item)
      this.ordered.push(item)
      stored.push(item)
    }
    return stored
  }

  async readAfter(cursor: string | null, limit = 100): Promise<EventPage> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`invalid event limit: ${limit}`)
    const after = cursor === null ? 0 : parseEventCursor(cursor)
    const matching = this.ordered.filter(item => item.sequence > after)
    const page = matching.slice(0, limit)
    const last = page.at(-1)
    return {
      events: page,
      nextCursor: last?.cursor ?? cursor,
      hasMore: matching.length > page.length,
    }
  }
}

export class InMemoryLeaseRepository implements LeaseRepository {
  private readonly leases = new Map<string, TaskLease>()

  async get(id: string): Promise<TaskLease | undefined> {
    return this.leases.get(id)
  }

  async findByTaskId(taskId: string): Promise<TaskLease | undefined> {
    return [...this.leases.values()].find(lease => lease.taskId === taskId)
  }

  async listExpired(at: number): Promise<readonly TaskLease[]> {
    return [...this.leases.values()]
      .filter(lease => lease.expiresAt <= at)
      .sort((left, right) => left.expiresAt - right.expiresAt)
  }

  async save(lease: TaskLease): Promise<void> {
    this.leases.set(lease.id, lease)
  }

  async delete(id: string): Promise<void> {
    this.leases.delete(id)
  }
}

export class InMemoryTaskRequestStore implements TaskRequestStore {
  private readonly requests = new Map<string, string>()

  async put(taskId: string, request: string): Promise<void> {
    this.requests.set(taskId, request)
  }

  async get(taskId: string): Promise<string | undefined> {
    return this.requests.get(taskId)
  }

  async delete(taskId: string): Promise<void> {
    this.requests.delete(taskId)
  }
}
