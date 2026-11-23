import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createJob, parseConfig, type FactoryEvent, type JobRecord } from '@anbiq/core';
import { signCallback } from '@anbiq/runner-github-actions';
import { BOARD_JS } from './board-assets.js';
import { createBoard } from './board.js';
import { SqliteEventSink } from './events.js';
import { createHandler } from './http.js';
import type { Logger } from './log.js';
import { SerialQueue } from './queue.js';
import { SqliteDatabase, SqliteJobStore } from './sqlite.js';

const PASSWORD = 'correct horse battery';
const EVENTS_SECRET = 'e'.repeat(40);
const NOW = new Date('2026-11-24T09:00:00Z');
const logger: Logger = { log: () => undefined };

const parsed = parseConfig(`
project: acme
taps: { slack: {} }
people:
  - name: Owner
    ids: { slack: U1 }
    roles: [requester, approver]
tracker: github-issues
git_host: github
runner: github-actions
engine: { id: claude-code }
checks: { verify: ['pnpm test'] }
budgets: { usd_per_day: 25, jobs_per_day: 10, concurrent_jobs: 1 }
`);
if (!parsed.ok) throw new Error(parsed.errors.join('; '));
const config = parsed.config;

const event = (overrides: Partial<FactoryEvent> = {}): FactoryEvent => ({
  v: 1,
  id: `ev-${Math.random()}`,
  at: NOW.toISOString(),
  project: 'acme',
  kind: 'run.started',
  job: 'acme-1',
  stage: 'build',
  actor: { type: 'crew', role: 'build', run: 'run-1' },
  summary: 'build crew started',
  ...overrides,
});

let server: Server | undefined;
afterEach(() => server?.close());

async function start() {
  const database = new SqliteDatabase(':memory:');
  const store = new SqliteJobStore(database);
  const events = new SqliteEventSink(database);
  const job: JobRecord = {
    ...createJob({
      id: 'acme-1',
      project: 'acme',
      title: 'Add a button',
      requestedBy: 'Owner',
      at: NOW.toISOString(),
    }),
    stage: 'build',
    request: 'the full private request text',
    thread: { tap: 'slack', channel: 'C1', thread: 'T1' },
    branch: 'anbiq/1',
    bounces: 0,
    activeRun: { id: 'run-1', url: 'https://github.test/run/1', stage: 'build' },
  };
  await store.save(job);
  const board = createBoard({
    password: PASSWORD,
    sessionSecret: 's'.repeat(40),
    config,
    store,
    events,
    logger,
    now: () => NOW,
  });
  const factory = {
    handleHttp: async () => ({ status: 200 }),
    handleRunResult: async () => undefined,
  };
  server = createServer(
    createHandler({
      factory,
      queue: new SerialQueue(logger),
      callbackSecret: 'c'.repeat(40),
      logger,
      now: () => NOW,
      board,
      events: { sink: events, secret: EVENTS_SECRET },
    }),
  );
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const get = (path: string, cookie?: string) =>
    fetch(`${base}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const login = (password: string) =>
    fetch(`${base}/board/login`, {
      method: 'POST',
      body: new URLSearchParams({ password }),
      redirect: 'manual',
    });
  const signIn = async () => (await login(PASSWORD)).headers.get('set-cookie')!.split(';')[0]!;
  return { base, events, get, login, signIn };
}

describe('the board', () => {
  it('shows the sign-in page until someone signs in, and keeps the data behind it', async () => {
    const { get } = await start();
    const page = await get('/board');
    expect(await page.text()).toContain('Sign in to watch the factory');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect((await get('/board/api/state')).status).toBe(401);
    expect((await get('/board/api/stream')).status).toBe(401);
  });

  it('signs in with the password and sets a strict, http-only session cookie', async () => {
    const { login, get } = await start();
    const wrong = await login('nope');
    expect(wrong.headers.get('location')).toBe('/board?failed=1');
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const right = await login(PASSWORD);
    const cookie = right.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect((await get('/board', cookie.split(';')[0])).status).toBe(200);
  });

  it('refuses forged or tampered session cookies', async () => {
    const { get, signIn } = await start();
    const cookie = await signIn();
    const [name, value] = cookie.split('=');
    const [expires, signature] = value!.split('.');
    const later = `${name}=${Number(expires) + 1000}.${signature}`;
    expect((await get('/board/api/state', later)).status).toBe(401);
    expect((await get('/board/api/state', `${name}=9999999999.forged`)).status).toBe(401);
  });

  it('slows down password guessing', async () => {
    const { login } = await start();
    for (let i = 0; i < 10; i++) await login(`guess-${i}`);
    expect((await login(PASSWORD)).status).toBe(429);
  });

  it("serves the pipeline, the crews and today's spend, without the request text", async () => {
    const { get, signIn, events } = await start();
    await events.emit(event());
    const state = (await (await get('/board/api/state', await signIn())).json()) as {
      jobs: { id: string; stage: string; activeRun?: { stage: string } }[];
      events: FactoryEvent[];
      budgets: { usd_per_day: number };
      usage: { runningJobs: number };
    };
    expect(state.jobs[0]).toMatchObject({
      id: 'acme-1',
      stage: 'build',
      activeRun: { stage: 'build' },
    });
    expect(JSON.stringify(state)).not.toContain('private request text');
    expect(state.budgets.usd_per_day).toBe(25);
    expect(state.usage.runningJobs).toBe(1);
    expect(state.events).toHaveLength(1);
  });

  it("returns a job's timeline oldest first", async () => {
    const { get, signIn, events } = await start();
    await events.emit(event({ id: 'a', at: '2026-11-24T08:00:00.000Z', kind: 'job.created' }));
    await events.emit(event({ id: 'b', at: '2026-11-24T08:05:00.000Z' }));
    await events.emit(event({ id: 'c', job: 'other' }));
    const timeline = (await (
      await get('/board/api/jobs/acme-1/events', await signIn())
    ).json()) as FactoryEvent[];
    expect(timeline.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('streams new events as they happen', async () => {
    const { base, signIn, events } = await start();
    const cookie = await signIn();
    const controller = new AbortController();
    const response = await fetch(`${base}/board/api/stream`, {
      headers: { cookie },
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    await reader.read(); // ": connected"
    await events.emit(event({ summary: 'qa crew started' }));
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('event: factory');
    expect(chunk).toContain('qa crew started');
    controller.abort();
  });

  it('never builds HTML from data in the browser', () => {
    expect(BOARD_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe('POST /events', () => {
  const signed = (body: string) => {
    const timestamp = String(Math.floor(NOW.getTime() / 1000));
    return {
      'content-type': 'application/json',
      'x-anbiq-timestamp': timestamp,
      'x-anbiq-signature': signCallback(EVENTS_SECRET, timestamp, body),
    };
  };

  it('stores a signed event from a factory running elsewhere', async () => {
    const { base, events } = await start();
    const body = JSON.stringify(event({ id: 'remote-1' }));
    const response = await fetch(`${base}/events`, { method: 'POST', body, headers: signed(body) });
    expect(response.status).toBe(202);
    expect(events.recent(10).map((e) => e.id)).toEqual(['remote-1']);
  });

  it('refuses unsigned or malformed events', async () => {
    const { base, events } = await start();
    const body = JSON.stringify(event());
    expect((await fetch(`${base}/events`, { method: 'POST', body })).status).toBe(401);
    const bad = JSON.stringify({ ...event(), kind: 'made.up' });
    expect(
      (await fetch(`${base}/events`, { method: 'POST', body: bad, headers: signed(bad) })).status,
    ).toBe(400);
    expect(events.recent(10)).toHaveLength(0);
  });
});
