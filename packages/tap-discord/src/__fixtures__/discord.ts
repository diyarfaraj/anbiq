import { generateKeyPairSync, sign } from 'node:crypto';
import type { InboundHttpRequest } from '@anbiq/core';

export const NOW = new Date('2026-11-24T09:00:00Z');

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
/** The application public key in the hex form the Developer Portal shows. */
export const PUBLIC_KEY = publicKey
  .export({ format: 'der', type: 'spki' })
  .subarray(12)
  .toString('hex');

let nextId = 1_000_000;

/** An interaction as Discord posts it, signed with the application's key. */
export function interaction(
  payload: Record<string, unknown>,
  options: { signed?: boolean; at?: Date } = {},
): InboundHttpRequest {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor((options.at ?? NOW).getTime() / 1000));
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.signed !== false) {
    headers['X-Signature-Timestamp'] = timestamp;
    headers['X-Signature-Ed25519'] = sign(null, Buffer.from(timestamp + body), privateKey).toString(
      'hex',
    );
  }
  return { method: 'POST', url: 'https://factory.test/taps/discord', headers, body };
}

export function command(input: {
  userId: string;
  channel: string;
  text: string;
  id?: string;
  bot?: boolean;
  name?: string;
}): Record<string, unknown> {
  return {
    id: input.id ?? String(++nextId),
    type: 2,
    channel_id: input.channel,
    guild_id: '42',
    member: { user: { id: input.userId, bot: input.bot ?? false } },
    data: {
      name: input.name ?? 'anbiq',
      options: [{ name: 'request', type: 3, value: input.text }],
    },
  };
}

export const ping = () => ({ id: String(++nextId), type: 1 });

/** A fake Discord REST API that records calls and answers with new snowflake IDs. */
export function fakeDiscordApi(failWith?: { status: number; message: string }) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let id = 7000;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      path: new URL(String(url)).pathname.replace('/api/v10', ''),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    if (failWith)
      return new Response(JSON.stringify({ message: failWith.message }), {
        status: failWith.status,
      });
    return new Response(JSON.stringify({ id: String(++id) }), { status: 200 });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
