import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { JobRecord, JobStore, ThreadRef, Usage } from '@anbiq/core';
import type { ConversationMemory } from '@anbiq/tap-whatsapp-twilio';

/** Delivered-message keys are kept this long; platforms stop retrying long before. */
const MESSAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const MIGRATIONS = [
  `CREATE TABLE jobs (
     id TEXT PRIMARY KEY,
     thread_key TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     queued INTEGER NOT NULL,
     running INTEGER NOT NULL,
     data TEXT NOT NULL
   );
   CREATE INDEX jobs_thread ON jobs (thread_key);
   CREATE INDEX jobs_created ON jobs (created_at);
   CREATE TABLE costs (job_id TEXT NOT NULL, usd REAL NOT NULL, at TEXT NOT NULL);
   CREATE INDEX costs_at ON costs (at);
   CREATE TABLE messages (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
   CREATE TABLE memory (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  `CREATE TABLE events (id TEXT PRIMARY KEY, at TEXT NOT NULL, job TEXT, data TEXT NOT NULL);
   CREATE INDEX events_at ON events (at);
   CREATE INDEX events_job ON events (job, at);`,
];

/** One SQLite file holding jobs, costs, delivered messages and tap conversation memory. */
export class SqliteDatabase {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    for (let next = version; next < MIGRATIONS.length; next++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[next]!);
        this.db.exec(`PRAGMA user_version = ${next + 1}`);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }
}

const threadKey = (thread: ThreadRef): string =>
  [thread.tap, thread.channel, thread.thread].join('\u0000');

export class SqliteJobStore implements JobStore {
  private readonly now: () => Date;

  constructor(
    private readonly database: SqliteDatabase,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  private get db(): DatabaseSync {
    return this.database.db;
  }

  async get(id: string): Promise<JobRecord | undefined> {
    const row = this.db.prepare('SELECT data FROM jobs WHERE id = ?').get(id) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as JobRecord) : undefined;
  }

  async save(job: JobRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO jobs (id, thread_key, created_at, updated_at, queued, running, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           thread_key = excluded.thread_key, updated_at = excluded.updated_at,
           queued = excluded.queued, running = excluded.running, data = excluded.data`,
      )
      .run(
        job.id,
        threadKey(job.thread),
        job.createdAt,
        job.updatedAt,
        job.queued === undefined ? 0 : 1,
        job.activeRun === undefined ? 0 : 1,
        JSON.stringify(job),
      );
  }

  async findByThread(thread: ThreadRef): Promise<JobRecord | undefined> {
    const row = this.db
      .prepare('SELECT data FROM jobs WHERE thread_key = ? ORDER BY rowid LIMIT 1')
      .get(threadKey(thread)) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as JobRecord) : undefined;
  }

  async listQueued(): Promise<JobRecord[]> {
    const rows = this.db
      .prepare('SELECT data FROM jobs WHERE queued = 1 ORDER BY updated_at, rowid')
      .all() as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as JobRecord);
  }

  /** The most recently updated jobs, newest first. Not part of the JobStore port; for the board. */
  listRecent(limit: number): JobRecord[] {
    const rows = this.db
      .prepare('SELECT data FROM jobs ORDER BY updated_at DESC, rowid DESC LIMIT ?')
      .all(limit) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as JobRecord);
  }

  async recordCost(jobId: string, usd: number, at: string): Promise<void> {
    this.db.prepare('INSERT INTO costs (job_id, usd, at) VALUES (?, ?, ?)').run(jobId, usd, at);
  }

  async usage(at: string): Promise<Usage> {
    const day = `${at.slice(0, 10)}%`;
    const spend = this.db
      .prepare('SELECT COALESCE(SUM(usd), 0) AS usd FROM costs WHERE at LIKE ?')
      .get(day) as { usd: number };
    const jobs = this.db
      .prepare('SELECT COUNT(*) AS n FROM jobs WHERE created_at LIKE ?')
      .get(day) as { n: number };
    const running = this.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE running = 1').get() as {
      n: number;
    };
    return { usdToday: spend.usd, jobsToday: jobs.n, runningJobs: running.n };
  }

  async claimMessage(key: string): Promise<boolean> {
    const now = this.now().getTime();
    this.db.prepare('DELETE FROM messages WHERE at < ?').run(now - MESSAGE_RETENTION_MS);
    const result = this.db
      .prepare('INSERT OR IGNORE INTO messages (key, at) VALUES (?, ?)')
      .run(key, now);
    return Number(result.changes) === 1;
  }
}

export class SqliteConversationMemory implements ConversationMemory {
  constructor(private readonly database: SqliteDatabase) {}

  async get(key: string): Promise<string | undefined> {
    const row = this.database.db.prepare('SELECT value FROM memory WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  async set(key: string, value: string): Promise<void> {
    this.database.db
      .prepare(
        'INSERT INTO memory (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }
}
