import { createHmac } from 'node:crypto';
import type { InboundHttpRequest } from '@anbiq/core';

export const SECRET = 'test-signing-secret';
export const NOW = new Date('2026-11-24T09:00:00Z');

let ts = 1_700_000_000;

/** A Slack Events API request, signed the way Slack signs it. */
export function slackRequest(
  payload: unknown,
  options: { secret?: string | null; at?: Date } = {},
): InboundHttpRequest {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor((options.at ?? NOW).getTime() / 1000));
  const secret = options.secret === undefined ? SECRET : options.secret;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) {
    headers['X-Slack-Request-Timestamp'] = timestamp;
    headers['X-Slack-Signature'] =
      `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  }
  return { method: 'POST', url: 'https://factory.test/taps/slack', headers, body };
}

export function messageEvent(input: {
  userId: string;
  channel: string;
  thread?: string;
  text: string;
  extra?: Record<string, unknown>;
}): unknown {
  return {
    type: 'event_callback',
    event_id: `Ev${ts}`,
    event: {
      type: 'message',
      user: input.userId,
      channel: input.channel,
      text: input.text,
      ts: `${++ts}.000100`,
      ...(input.thread ? { thread_ts: input.thread } : {}),
      ...input.extra,
    },
  };
}

/** A fake Slack Web API that records chat.postMessage calls. */
export function fakeSlackApi(reply: { ok: boolean; error?: string } = { ok: true }) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
    [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}
