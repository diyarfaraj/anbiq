import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { staticToken } from '@anbiq/github';
import { signCallback } from '@anbiq/runner-github-actions';
import { fakeGitHub } from '../../github/src/__fixtures__/github.js';
import { messageEvent, NOW, SECRET, slackRequest } from '../../tap-slack/src/__fixtures__/slack.js';
import { buildApp, loadSettings, StartupError, type App } from './app.js';
import { createHandler, MAX_BODY_BYTES } from './http.js';
import type { Logger } from './log.js';
import { SqliteJobStore } from './sqlite.js';

const OWNER = 'U_OWNER';
const CALLBACK_SECRET = 'c'.repeat(40);
const dir = mkdtempSync(join(tmpdir(), 'anbiq-server-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CONFIG = `
project: acme
taps:
  slack: { channels: [C1] }
people:
  - name: Owner
    ids: { slack: ${OWNER} }
    roles: [requester, approver]
tracker: github-issues
git_host: github
runner: github-actions
engine: { id: claude-code }
checks: { verify: ['pnpm test'] }
budgets: { usd_per_day: 25, jobs_per_day: 10, concurrent_jobs: 1 }
`;

let configCount = 0;
function envWith(overrides: Record<string, string | undefined> = {}, config = CONFIG) {
  const path = join(dir, `anbiq-${++configCount}.yml`);
  writeFileSync(path, config);
  return {
    ANBIQ_CONFIG: path,
    ANBIQ_DATA: ':memory:',
    ANBIQ_PUBLIC_URL: 'https://factory.test',
    ANBIQ_CALLBACK_SECRET: CALLBACK_SECRET,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: 'unused in tests',
    GITHUB_APP_INSTALLATION_ID: '2',
    SLACK_SIGNING_SECRET: SECRET,
    SLACK_BOT_TOKEN: 'xoxb-test',
    ...overrides,
  };
}

/** GitHub, GitHub Actions and Slack, in memory. */
function fakeServices() {
  const github = fakeGitHub();
  const dispatches: Record<string, string>[] = [];
  const slackPosts: Record<string, unknown>[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'slack.com') {
      slackPosts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true, ts: '1.1' }), { status: 200 });
    }
    if (url.pathname.endsWith('/dispatches')) {
      dispatches.push(
        (JSON.parse(String(init?.body)) as { inputs: Record<string, string> }).inputs,
      );
      return new Response(null, { status: 204 });
    }
    return github.fetch(input, init);
  }) as typeof fetch;
  return { github, dispatches, slackPosts, fetch: fetchImpl };
}

const logs: string[] = [];
const logger: Logger = {
  log: (level, message, fields) => logs.push(JSON.stringify({ level, message, ...fields })),
};

let server: Server | undefined;
afterEach(() => server?.close());

async function start(env = envWith()) {
  const services = fakeServices();
  const { settings, config } = loadSettings(env);
  const app: App = buildApp(settings, config, env, {
    logger,
    auth: staticToken('t'),
    fetch: services.fetch,
    now: () => NOW,
  });
  server = createServer(
    createHandler({
      factory: app.factory,
      queue: app.queue,
      callbackSecret: CALLBACK_SECRET,
      logger,
      now: () => NOW,
    }),
  );
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', body, headers });
  return { app, services, base, post };
}

function slack(text: string, options: { secret?: string | null } = {}) {
  const request = slackRequest(messageEvent({ userId: OWNER, channel: 'C1', text }), options);
  return { body: request.body, headers: request.headers as Record<string, string> };
}

function callback(runId: string, result: Record<string, unknown>) {
  const body = JSON.stringify({ runId, ...result });
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-anbiq-timestamp': timestamp,
      'x-anbiq-signature': signCallback(CALLBACK_SECRET, timestamp, body),
    },
  };
}

describe('the server', () => {
  it('turns a Slack message into an issue and a crew run, then moves on when the run reports', async () => {
    const { app, services, post } = await start();
    const message = slack('Add a copy-link button');
    expect((await post('/taps/slack', message.body, message.headers)).status).toBe(200);
    await app.queue.idle();

    expect(services.github.issues.size).toBe(1);
    expect(services.dispatches).toHaveLength(1);
    const spec = services.dispatches[0]!;
    expect(spec.stage).toBe('spec');

    const done = callback(spec.run_id!, {
      jobId: spec.job_id,
      stage: 'spec',
      outcome: 'passed',
      summary: '1. A button copies the link.',
      costUsd: 0.2,
    });
    expect((await post(`/runs/${spec.run_id}`, done.body, done.headers)).status).toBe(200);
    expect(services.dispatches.at(-1)?.stage).toBe('build');
    const usage = await new SqliteJobStore(app.database).usage(NOW.toISOString());
    expect(usage.usdToday).toBe(0.2);
  });

  it('refuses unsigned webhooks and forged callbacks', async () => {
    const { services, post } = await start();
    const unsigned = slack('Add a button', { secret: null });
    expect((await post('/taps/slack', unsigned.body, unsigned.headers)).status).toBe(401);

    const forged = callback('run-1', {
      jobId: 'x',
      stage: 'spec',
      outcome: 'passed',
      summary: 's',
    });
    forged.headers['x-anbiq-signature'] = `sha256=${'0'.repeat(64)}`;
    expect((await post('/runs/run-1', forged.body, forged.headers)).status).toBe(401);
    expect(services.dispatches).toHaveLength(0);
  });

  it('rejects a well-signed callback that does not validate', async () => {
    const { post } = await start();
    const bad = callback('run-1', { jobId: 'x', stage: 'deploy', outcome: 'passed', summary: 's' });
    expect((await post('/runs/run-1', bad.body, bad.headers)).status).toBe(400);
  });

  it('answers health checks, unknown paths and oversized bodies', async () => {
    const { base, post } = await start();
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok');
    expect((await post('/nope', '')).status).toBe(404);
    expect((await post('/taps/slack', 'x'.repeat(MAX_BODY_BYTES + 1))).status).toBe(413);
  });

  it('never logs message text', async () => {
    const { app, post } = await start();
    const message = slack('my secret plan for the launch');
    await post('/taps/slack', message.body, message.headers);
    await app.queue.idle();
    expect(logs.join('\n')).not.toContain('secret plan');
  });
});

describe('loadSettings', () => {
  it('lists every missing or invalid setting at once', () => {
    const error = (() => {
      try {
        loadSettings(
          envWith({ ANBIQ_PUBLIC_URL: 'http://insecure.test', ANBIQ_CALLBACK_SECRET: 'short' }),
        );
      } catch (e) {
        return e;
      }
    })() as StartupError;
    expect(error).toBeInstanceOf(StartupError);
    expect(error.problems.join('\n')).toMatch(/ANBIQ_PUBLIC_URL/);
    expect(error.problems.join('\n')).toMatch(/ANBIQ_CALLBACK_SECRET/);
  });

  it('refuses an invalid anbiq.yml, unsupported slots and missing tap secrets', () => {
    const config = CONFIG.replace('runner: github-actions', 'runner: jenkins');
    const run = () => loadSettings(envWith({ SLACK_BOT_TOKEN: undefined }, config));
    expect(run).toThrow(/runner "jenkins" is not supported/);
    expect(run).toThrow(/SLACK_BOT_TOKEN is required for the slack tap/);
    expect(() => loadSettings(envWith({}, 'project: acme'))).toThrow(/anbiq\.yml/);
  });

  it('checks tap options in anbiq.yml', () => {
    const config = CONFIG.replace('slack: { channels: [C1] }', 'slack: { channels: [] }');
    expect(() => loadSettings(envWith({}, config))).toThrow(/taps\.slack\.channels/);
  });
});
