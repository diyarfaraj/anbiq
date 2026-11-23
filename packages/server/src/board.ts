import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AnbiqConfig, JobRecord, JobStore } from '@anbiq/core';
import { BOARD_CSS, BOARD_HTML, BOARD_JS, LOGIN_HTML } from './board-assets.js';
import type { SqliteEventSink } from './events.js';
import type { Logger } from './log.js';

export interface BoardOptions {
  password: string;
  /** Signs session cookies. */
  sessionSecret: string;
  config: AnbiqConfig;
  store: JobStore & { listRecent(limit: number): JobRecord[] };
  events: SqliteEventSink;
  logger: Logger;
  now?: () => Date;
}

const COOKIE = 'anbiq_board';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const HEARTBEAT_MS = 25_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURES_ALLOWED = 10;

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

/** A read-only web view of the factory, behind a password. */
export function createBoard(options: BoardOptions) {
  const { config, store, events, logger } = options;
  const now = () => options.now?.() ?? new Date();
  let failures: number[] = [];

  const sign = (value: string) =>
    createHmac('sha256', options.sessionSecret).update(`board:${value}`).digest('base64url');

  function authenticated(request: IncomingMessage): boolean {
    const cookie = parseCookies(request.headers.cookie)[COOKIE];
    if (!cookie) return false;
    const [expires, signature] = cookie.split('.');
    if (!expires || !signature || !/^\d+$/.test(expires)) return false;
    if (Number(expires) * 1000 < now().getTime()) return false;
    return safeEqual(signature, sign(expires));
  }

  function send(
    response: ServerResponse,
    status: number,
    body: string,
    type: string,
    headers: Record<string, string> = {},
  ): void {
    response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, ...headers });
    response.end(body);
  }

  const json = (response: ServerResponse, value: unknown) =>
    send(response, 200, JSON.stringify(value), 'application/json');

  async function login(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const cutoff = now().getTime() - LOGIN_WINDOW_MS;
    failures = failures.filter((at) => at > cutoff);
    if (failures.length >= LOGIN_FAILURES_ALLOWED) {
      send(response, 429, 'Too many attempts. Try again later.', 'text/plain');
      return;
    }
    const form = new URLSearchParams(await readSmallBody(request));
    if (
      !safeEqual(
        sign(`password:${form.get('password') ?? ''}`),
        sign(`password:${options.password}`),
      )
    ) {
      failures.push(now().getTime());
      logger.log('warn', 'board login failed');
      send(response, 303, '', 'text/plain', { location: '/board?failed=1' });
      return;
    }
    const expires = String(Math.floor(now().getTime() / 1000) + SESSION_SECONDS);
    send(response, 303, '', 'text/plain', {
      location: '/board',
      'set-cookie': `${COOKIE}=${expires}.${sign(expires)}; Path=/board; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
    });
  }

  async function state() {
    const at = now().toISOString();
    return {
      project: config.project,
      enabled: config.enabled,
      now: at,
      budgets: config.budgets,
      usage: await store.usage(at),
      jobs: store.listRecent(200).map(publicJob),
      events: events.recent(200),
    };
  }

  function stream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(': connected\n\n');
    const unsubscribe = events.subscribe((event) => {
      response.write(`event: factory\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), HEARTBEAT_MS);
    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  /** Handles a request under /board. */
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<void> => {
    const method = request.method ?? 'GET';
    if (method === 'GET' && path === '/board/app.css')
      return send(response, 200, BOARD_CSS, 'text/css');
    if (method === 'GET' && path === '/board/app.js')
      return send(response, 200, BOARD_JS, 'text/javascript');
    if (method === 'POST' && path === '/board/login') return login(request, response);

    const signedIn = authenticated(request);
    if (method === 'GET' && (path === '/board' || path === '/board/')) {
      return send(response, 200, signedIn ? BOARD_HTML : LOGIN_HTML, 'text/html; charset=utf-8');
    }
    if (!signedIn) return send(response, 401, 'Sign in at /board', 'text/plain');

    if (method === 'POST' && path === '/board/logout') {
      return send(response, 303, '', 'text/plain', {
        location: '/board',
        'set-cookie': `${COOKIE}=; Path=/board; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      });
    }
    if (method === 'GET' && path === '/board/api/state') return json(response, await state());
    if (method === 'GET' && path === '/board/api/stream') return stream(request, response);
    const job = /^\/board\/api\/jobs\/([^/]+)\/events$/.exec(path)?.[1];
    if (method === 'GET' && job) return json(response, events.forJob(decodeURIComponent(job)));
    send(response, 404, 'Not found', 'text/plain');
  };
}

/** What the board shows of a job: its title, never the full request, feedback or answers. */
function publicJob(job: JobRecord) {
  return {
    id: job.id,
    title: job.title,
    stage: job.stage,
    requestedBy: job.requestedBy,
    revisions: job.revisions,
    bounces: job.bounces,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    issue: job.issue?.url,
    pullRequest: job.pullRequest?.url,
    activeRun: job.activeRun ? { stage: job.activeRun.stage, url: job.activeRun.url } : undefined,
    queued: job.queued?.stage,
  };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

async function readSmallBody(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request as AsyncIterable<Buffer>) {
    body += chunk.toString('utf8');
    if (body.length > 4096) break;
  }
  return body;
}
