/** SQLite-backed implementation of SHE core repositories and event store. */

import { DatabaseSync } from 'node:sqlite'
import type {
  Artifact,
  ArtifactRepository,
  DomainAggregateType,
  EventPage,
  EventStore,
  EventStoreBounds,
  LeaseRepository,
  SheDomainEvent,
  StoredEvent,
  Task,
  TaskPriority,
  TaskRepository,
  TaskRequestStore,
  TaskRisk,
  TaskStatus,
  TaskLease,
  Topic,
  TopicRepository,
  TopicStatus,
} from '@she/core'
import { eventCursor, parseEventCursor } from '@she/core'
import { SQLITE_STORE_MIGRATIONS } from './schema.js'

type SqlValue = string | number | null

interface TopicRow {
  id: string
  conversation_key: string
  display_no: string | null
  title: string
  workspace_key: string
  status: string
  active_task_id: string | null
  created_at: number
  updated_at: number
  last_active_at: number
}

interface TaskRow {
  id: string
  topic_id: string
  seq: number
  status: string
  priority: string
  risk: string
  request_hash: string
  request_excerpt: string
  idempotency_key: string | null
  attachments_json: string
  agent_session_id: string | null
  sandbox_name: string | null
  report_artifact_id: string | null
  error_json: string | null
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
}

interface ArtifactRow {
  id: string
  task_id: string
  kind: string
  file_name: string
  bytes: number
  sha256: string
  storage_ref: string
  created_at: number
}

interface LeaseRow {
  id: string
  task_id: string
  topic_id: string
  owner_id: string
  acquired_at: number
  heartbeat_at: number
  expires_at: number
  ttl_ms: number
}

interface EventRow {
  sequence: number
  event_id: string
  cursor: string
  aggregate_type: string
  aggregate_id: string
  type: string
  occurred_at: number
  idempotency_key: string | null
  payload_json: string
}

interface MigrationRow {
  version: number
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function topicOf(row: TopicRow): Topic {
  return {
    id: row.id,
    conversationKey: row.conversation_key,
    displayNo: row.display_no,
    title: row.title,
    workspaceKey: row.workspace_key,
    status: row.status as TopicStatus,
    activeTaskId: row.active_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
  }
}

function taskOf(row: TaskRow): Task {
  return {
    id: row.id,
    topicId: row.topic_id,
    seq: row.seq,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    risk: row.risk as TaskRisk,
    requestHash: row.request_hash,
    requestExcerpt: row.request_excerpt,
    idempotencyKey: row.idempotency_key,
    attachments: parseJson(row.attachments_json),
    agentSessionId: row.agent_session_id,
    sandboxName: row.sandbox_name,
    reportArtifactId: row.report_artifact_id,
    error: row.error_json === null ? null : parseJson(row.error_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

function artifactOf(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind as Artifact['kind'],
    fileName: row.file_name,
    bytes: row.bytes,
    sha256: row.sha256,
    storageRef: row.storage_ref,
    createdAt: row.created_at,
  }
}

function leaseOf(row: LeaseRow): TaskLease {
  return {
    id: row.id,
    taskId: row.task_id,
    topicId: row.topic_id,
    ownerId: row.owner_id,
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    ttlMs: row.ttl_ms,
  }
}

function eventOf(row: EventRow): StoredEvent<SheDomainEvent> {
  return {
    cursor: row.cursor,
    sequence: row.sequence,
    event: {
      eventId: row.event_id,
      aggregateType: row.aggregate_type as DomainAggregateType,
      aggregateId: row.aggregate_id,
      type: row.type,
      occurredAt: row.occurred_at,
      ...(row.idempotency_key === null ? {} : { idempotencyKey: row.idempotency_key }),
      payload: parseJson(row.payload_json),
    } as SheDomainEvent,
  }
}

function applyMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as unknown as MigrationRow[])
      .map(row => row.version),
  )
  for (const migration of SQLITE_STORE_MIGRATIONS) {
    if (applied.has(migration.version)) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

class SqliteTopicRepository implements TopicRepository {
  constructor(private readonly db: DatabaseSync) {}

  async get(id: string): Promise<Topic | undefined> {
    const row = this.db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as TopicRow | undefined
    return row === undefined ? undefined : topicOf(row)
  }

  async findActiveByConversation(conversationKey: string): Promise<Topic | undefined> {
    const row = this.db.prepare(
      "SELECT * FROM topics WHERE conversation_key = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    ).get(conversationKey) as TopicRow | undefined
    return row === undefined ? undefined : topicOf(row)
  }

  async listByConversation(conversationKey: string): Promise<readonly Topic[]> {
    const rows = this.db.prepare(
      'SELECT * FROM topics WHERE conversation_key = ? ORDER BY created_at ASC',
    ).all(conversationKey) as unknown as TopicRow[]
    return rows.map(topicOf)
  }

  async nextDisplayNo(conversationKey: string): Promise<string> {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(CAST(display_no AS INTEGER)), 0) + 1 AS next FROM topics WHERE conversation_key = ?',
    ).get(conversationKey) as { next: number }
    return String(row.next)
  }

  async save(topic: Topic): Promise<void> {
    this.db.prepare(`
      INSERT INTO topics (
        id, conversation_key, display_no, title, workspace_key, status,
        active_task_id, created_at, updated_at, last_active_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        conversation_key = excluded.conversation_key,
        display_no = excluded.display_no,
        title = excluded.title,
        workspace_key = excluded.workspace_key,
        status = excluded.status,
        active_task_id = excluded.active_task_id,
        updated_at = excluded.updated_at,
        last_active_at = excluded.last_active_at
    `).run(
      topic.id,
      topic.conversationKey,
      topic.displayNo,
      topic.title,
      topic.workspaceKey,
      topic.status,
      topic.activeTaskId,
      topic.createdAt,
      topic.updatedAt,
      topic.lastActiveAt,
    )
  }
}

class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  async get(id: string): Promise<Task | undefined> {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row === undefined ? undefined : taskOf(row)
  }

  async findByIdempotencyKey(key: string): Promise<Task | undefined> {
    const row = this.db.prepare('SELECT * FROM tasks WHERE idempotency_key = ?').get(key) as TaskRow | undefined
    return row === undefined ? undefined : taskOf(row)
  }

  async listByTopic(topicId: string): Promise<readonly Task[]> {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE topic_id = ? ORDER BY seq ASC')
      .all(topicId) as unknown as TaskRow[]
    return rows.map(taskOf)
  }

  async listAll(): Promise<readonly Task[]> {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at ASC, topic_id ASC, seq ASC')
      .all() as unknown as TaskRow[]
    return rows.map(taskOf)
  }

  async nextSeq(topicId: string): Promise<number> {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tasks WHERE topic_id = ?',
    ).get(topicId) as { next: number }
    return row.next
  }

  async save(task: Task): Promise<void> {
    this.db.prepare(`
      INSERT INTO tasks (
        id, topic_id, seq, status, priority, risk, request_hash, request_excerpt,
        idempotency_key, attachments_json, agent_session_id, sandbox_name,
        report_artifact_id, error_json, created_at, updated_at, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        priority = excluded.priority,
        risk = excluded.risk,
        attachments_json = excluded.attachments_json,
        agent_session_id = excluded.agent_session_id,
        sandbox_name = excluded.sandbox_name,
        report_artifact_id = excluded.report_artifact_id,
        error_json = excluded.error_json,
        updated_at = excluded.updated_at,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at
    `).run(
      task.id,
      task.topicId,
      task.seq,
      task.status,
      task.priority,
      task.risk,
      task.requestHash,
      task.requestExcerpt,
      task.idempotencyKey,
      JSON.stringify(task.attachments),
      task.agentSessionId,
      task.sandboxName,
      task.reportArtifactId,
      task.error === null ? null : JSON.stringify(task.error),
      task.createdAt,
      task.updatedAt,
      task.startedAt,
      task.finishedAt,
    )
  }
}

class SqliteArtifactRepository implements ArtifactRepository {
  constructor(private readonly db: DatabaseSync) {}

  async get(id: string): Promise<Artifact | undefined> {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as ArtifactRow | undefined
    return row === undefined ? undefined : artifactOf(row)
  }

  async listByTask(taskId: string): Promise<readonly Artifact[]> {
    const rows = this.db.prepare('SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as unknown as ArtifactRow[]
    return rows.map(artifactOf)
  }

  async save(artifact: Artifact): Promise<void> {
    this.db.prepare(`
      INSERT INTO artifacts (
        id, task_id, kind, file_name, bytes, sha256, storage_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        file_name = excluded.file_name,
        bytes = excluded.bytes,
        sha256 = excluded.sha256,
        storage_ref = excluded.storage_ref
    `).run(
      artifact.id,
      artifact.taskId,
      artifact.kind,
      artifact.fileName,
      artifact.bytes,
      artifact.sha256,
      artifact.storageRef,
      artifact.createdAt,
    )
  }
}

class SqliteLeaseRepository implements LeaseRepository {
  constructor(private readonly db: DatabaseSync) {}

  async get(id: string): Promise<TaskLease | undefined> {
    const row = this.db.prepare('SELECT * FROM leases WHERE id = ?').get(id) as LeaseRow | undefined
    return row === undefined ? undefined : leaseOf(row)
  }

  async findByTaskId(taskId: string): Promise<TaskLease | undefined> {
    const row = this.db.prepare('SELECT * FROM leases WHERE task_id = ?').get(taskId) as LeaseRow | undefined
    return row === undefined ? undefined : leaseOf(row)
  }

  async listExpired(at: number): Promise<readonly TaskLease[]> {
    const rows = this.db.prepare('SELECT * FROM leases WHERE expires_at <= ? ORDER BY expires_at ASC')
      .all(at) as unknown as LeaseRow[]
    return rows.map(leaseOf)
  }

  async save(lease: TaskLease): Promise<void> {
    this.db.prepare(`
      INSERT INTO leases (
        id, task_id, topic_id, owner_id, acquired_at, heartbeat_at, expires_at, ttl_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        heartbeat_at = excluded.heartbeat_at,
        expires_at = excluded.expires_at,
        ttl_ms = excluded.ttl_ms
    `).run(
      lease.id,
      lease.taskId,
      lease.topicId,
      lease.ownerId,
      lease.acquiredAt,
      lease.heartbeatAt,
      lease.expiresAt,
      lease.ttlMs,
    )
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM leases WHERE id = ?').run(id)
  }
}

class SqliteTaskRequestStore implements TaskRequestStore {
  constructor(private readonly db: DatabaseSync) {}

  async put(taskId: string, request: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO task_requests (task_id, request_text, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        request_text = excluded.request_text,
        created_at = excluded.created_at
    `).run(taskId, request, Date.now())
  }

  async get(taskId: string): Promise<string | undefined> {
    const row = this.db.prepare('SELECT request_text FROM task_requests WHERE task_id = ?')
      .get(taskId) as { request_text: string } | undefined
    return row?.request_text
  }

  async delete(taskId: string): Promise<void> {
    this.db.prepare('DELETE FROM task_requests WHERE task_id = ?').run(taskId)
  }
}

class SqliteEventStore implements EventStore {
  constructor(private readonly db: DatabaseSync) {}

  async append(events: readonly SheDomainEvent[]): Promise<readonly StoredEvent<SheDomainEvent>[]> {
    if (events.length === 0) return []
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const stored: StoredEvent<SheDomainEvent>[] = []
      for (const event of events) {
        const existing = this.db.prepare('SELECT * FROM events WHERE event_id = ?')
          .get(event.eventId) as EventRow | undefined
        if (existing !== undefined) {
          stored.push(eventOf(existing))
          continue
        }
        const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM events')
          .get() as { next: number }
        const cursor = eventCursor(next.next)
        this.db.prepare(`
          INSERT INTO events (
            sequence, event_id, cursor, aggregate_type, aggregate_id, type,
            occurred_at, idempotency_key, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          next.next,
          event.eventId,
          cursor,
          event.aggregateType,
          event.aggregateId,
          event.type,
          event.occurredAt,
          event.idempotencyKey ?? null,
          JSON.stringify(event.payload),
        )
        stored.push({
          sequence: next.next,
          cursor,
          event,
        })
      }
      this.db.exec('COMMIT')
      return stored
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async readAfter(cursor: string | null, limit = 100): Promise<EventPage> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`invalid event limit: ${limit}`)
    const after = cursor === null ? 0 : parseEventCursor(cursor)
    const rows = this.db.prepare(
      'SELECT * FROM events WHERE sequence > ? ORDER BY sequence ASC LIMIT ?',
    ).all(after, limit + 1) as unknown as EventRow[]
    const page = rows.slice(0, limit).map(eventOf)
    const last = page.at(-1)
    return {
      events: page,
      nextCursor: last?.cursor ?? cursor,
      hasMore: rows.length > limit,
    }
  }

  async bounds(): Promise<EventStoreBounds> {
    const row = this.db.prepare(`
      SELECT
        MIN(sequence) AS oldest_sequence,
        MAX(sequence) AS newest_sequence,
        COUNT(*) AS count,
        (SELECT occurred_at FROM events ORDER BY sequence ASC LIMIT 1) AS oldest_occurred_at
      FROM events
    `).get() as { oldest_sequence: number | null; newest_sequence: number | null; count: number; oldest_occurred_at: number | null }
    return {
      oldestSequence: row.oldest_sequence,
      newestSequence: row.newest_sequence,
      oldestOccurredAt: row.oldest_occurred_at,
      count: row.count,
    }
  }

  async pruneBefore(sequence: number): Promise<number> {
    const result = this.db.prepare('DELETE FROM events WHERE sequence < ?').run(sequence)
    return Number(result.changes)
  }
}

/**
 * SQLite-backed store.
 *
 * Opening the store applies idempotent schema migrations. Call `close()` before
 * reopening the same file in tests or service shutdown paths.
 */
export class SqliteStore {
  readonly topics: TopicRepository
  readonly tasks: TaskRepository
  readonly artifacts: ArtifactRepository
  readonly leases: LeaseRepository
  readonly requests: TaskRequestStore
  readonly events: EventStore

  private constructor(private readonly db: DatabaseSync) {
    this.topics = new SqliteTopicRepository(db)
    this.tasks = new SqliteTaskRepository(db)
    this.artifacts = new SqliteArtifactRepository(db)
    this.leases = new SqliteLeaseRepository(db)
    this.requests = new SqliteTaskRequestStore(db)
    this.events = new SqliteEventStore(db)
  }

  static open(path: string): SqliteStore {
    if (path.trim() === '') throw new Error('SQLite store path must not be empty')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
    applyMigrations(db)
    return new SqliteStore(db)
  }

  /** Number of applied schema migrations, useful for `she doctor`. */
  schemaVersion(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }
    return row.count
  }

  close(): void {
    this.db.close()
  }
}

export type SqlValueExport = SqlValue
