import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createJob, type JobRecord } from '@anbiq/core';
import { describeJobStoreConformance } from '@anbiq/testkit';
import { SqliteConversationMemory, SqliteDatabase, SqliteJobStore } from './sqlite.js';

describeJobStoreConformance(
  'SqliteJobStore',
  () => new SqliteJobStore(new SqliteDatabase(':memory:')),
);

const dir = mkdtempSync(join(tmpdir(), 'anbiq-sqlite-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const job = (id: string): JobRecord => ({
  ...createJob({
    id,
    project: 'acme',
    title: id,
    requestedBy: 'Owner',
    at: '2026-11-24T09:00:00.000Z',
  }),
  request: id,
  thread: { tap: 'slack', channel: 'C1', thread: id },
  branch: `anbiq/${id}`,
  bounces: 0,
});

describe('SqliteDatabase', () => {
  it('keeps jobs, delivered messages and memory across restarts', async () => {
    const path = join(dir, 'nested', 'anbiq.db');
    const first = new SqliteDatabase(path);
    await new SqliteJobStore(first).save(job('a'));
    await new SqliteJobStore(first).claimMessage('slack:C1:1');
    await new SqliteConversationMemory(first).set('wa:SM1', 'thread-1');
    first.close();

    const second = new SqliteDatabase(path);
    const store = new SqliteJobStore(second);
    expect((await store.get('a'))?.request).toBe('a');
    expect(await store.claimMessage('slack:C1:1')).toBe(false);
    expect(await new SqliteConversationMemory(second).get('wa:SM1')).toBe('thread-1');
    second.close();
  });

  it('forgets delivered messages after a week, so the table stays small', async () => {
    let now = new Date('2026-11-01T00:00:00Z');
    const store = new SqliteJobStore(new SqliteDatabase(':memory:'), { now: () => now });
    expect(await store.claimMessage('old')).toBe(true);
    now = new Date('2026-11-09T00:00:00Z');
    expect(await store.claimMessage('old')).toBe(true);
  });

  it('overwrites conversation memory for the same key', async () => {
    const memory = new SqliteConversationMemory(new SqliteDatabase(':memory:'));
    await memory.set('k', 'one');
    await memory.set('k', 'two');
    expect(await memory.get('k')).toBe('two');
    expect(await memory.get('missing')).toBeUndefined();
  });
});
