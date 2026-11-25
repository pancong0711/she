/** SQLite schema migrations for the SHE control-plane store. */

export interface SqliteMigration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

export const SQLITE_STORE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: 'initial control-plane schema',
    sql: `
      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        conversation_key TEXT NOT NULL,
        display_no TEXT,
        title TEXT NOT NULL,
        workspace_key TEXT NOT NULL,
        status TEXT NOT NULL,
        active_task_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_topics_conversation
        ON topics(conversation_key, status, created_at);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        risk TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        request_excerpt TEXT NOT NULL,
        idempotency_key TEXT,
        attachments_json TEXT NOT NULL,
        agent_session_id TEXT,
        sandbox_name TEXT,
        report_artifact_id TEXT,
        error_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        UNIQUE(topic_id, seq)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency
        ON tasks(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_tasks_topic
        ON tasks(topic_id, seq);

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_name TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        storage_ref TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_task
        ON artifacts(task_id, created_at);

      CREATE TABLE IF NOT EXISTS leases (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,
        topic_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        heartbeat_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_leases_expiry
        ON leases(expires_at);

      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        cursor TEXT NOT NULL UNIQUE,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        idempotency_key TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_sequence
        ON events(sequence);
    `,
  },
  {
    version: 2,
    name: 'ephemeral task request spool',
    sql: `
      CREATE TABLE IF NOT EXISTS task_requests (
        task_id TEXT PRIMARY KEY,
        request_text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
]
