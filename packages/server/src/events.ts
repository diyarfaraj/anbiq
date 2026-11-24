import { STAGES, type EventSink, type FactoryEvent } from '@anbiq/core';
import { z } from 'zod';
import type { SqliteDatabase } from './sqlite.js';

/** Events older than this are deleted, so the file does not grow without bound. */
const RETENTION_DAYS = 90;

/** Keeps factory events and passes each new one to live subscribers (the board's stream). */
export class SqliteEventSink implements EventSink {
  private readonly listeners = new Set<(event: FactoryEvent) => void>();
  private emitted = 0;

  constructor(private readonly database: SqliteDatabase) {}

  async emit(event: FactoryEvent): Promise<void> {
    this.database.db
      .prepare('INSERT OR IGNORE INTO events (id, at, job, data) VALUES (?, ?, ?, ?)')
      .run(event.id, event.at, event.job ?? null, JSON.stringify(event));
    if (++this.emitted % 500 === 0) this.prune(event.at);
    for (const listener of this.listeners) listener(event);
  }

  /** Newest first. */
  recent(limit: number): FactoryEvent[] {
    return this.rows(
      this.database.db
        .prepare('SELECT data FROM events ORDER BY at DESC, rowid DESC LIMIT ?')
        .all(limit),
    );
  }

  /** Oldest first: the job's timeline. */
  forJob(job: string): FactoryEvent[] {
    return this.rows(
      this.database.db
        .prepare('SELECT data FROM events WHERE job = ? ORDER BY at, rowid LIMIT 1000')
        .all(job),
    );
  }

  /** How many events of one kind happened since `since`. */
  countSince(kind: FactoryEvent['kind'], since: string): number {
    const row = this.database.db
      .prepare(
        "SELECT COUNT(*) AS n FROM events WHERE at >= ? AND json_extract(data, '$.kind') = ?",
      )
      .get(since, kind) as { n: number };
    return row.n;
  }

  subscribe(listener: (event: FactoryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private prune(at: string): void {
    const cutoff = new Date(Date.parse(at) - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    this.database.db.prepare('DELETE FROM events WHERE at < ?').run(cutoff);
  }

  private rows(rows: unknown[]): FactoryEvent[] {
    return (rows as { data: string }[]).map((row) => JSON.parse(row.data) as FactoryEvent);
  }
}

const crewStage = z.enum(['spec', 'build', 'qa', 'review']);

/** For events posted by a factory running elsewhere. */
export const factoryEventSchema = z
  .object({
    v: z.literal(1),
    id: z.string().min(1).max(100),
    at: z.iso.datetime(),
    project: z.string().min(1).max(200),
    kind: z.enum([
      'request.received',
      'request.rejected',
      'job.created',
      'stage.entered',
      'run.started',
      'run.finished',
      'pr.opened',
      'approval.requested',
      'approval.given',
      'approval.rejected',
      'merged',
      'deployed',
      'budget.exceeded',
    ]),
    job: z.string().min(1).max(200).optional(),
    stage: z.enum(STAGES).optional(),
    actor: z.discriminatedUnion('type', [
      z.object({ type: z.literal('person'), name: z.string().max(200) }),
      z.object({ type: z.literal('crew'), role: crewStage, run: z.string().max(100) }),
      z.object({ type: z.literal('system') }),
    ]),
    summary: z.string().max(8000),
    links: z
      .object({
        issue: z.url().optional(),
        pr: z.url().optional(),
        run: z.url().optional(),
      })
      .optional(),
    costUsd: z.number().min(0).optional(),
  })
  .strict();
