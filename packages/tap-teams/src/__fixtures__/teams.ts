import { createSign, generateKeyPairSync } from 'node:crypto';
import type { InboundHttpRequest } from '@anbiq/core';

export const NOW = new Date('2026-11-24T09:00:00Z');
export const APP_ID = '00000000-0000-0000-0000-00000000a99b';
export const TENANT = 'tenant-1';
export const CHANNEL = '19:general@thread.tacv2';
export const SERVICE_URL = 'https://smba.trafficmanager.net/emea/';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, endorsements: ['msteams'] };

/** A Bot Framework token, signed with the fake Microsoft key. */
export function botToken(claims: Record<string, unknown> = {}): string {
  const now = Math.floor(NOW.getTime() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: KID });
  const payload = encode({
    iss: 'https://api.botframework.com',
    aud: APP_ID,
    nbf: now - 60,
    exp: now + 3600,
    serviceurl: SERVICE_URL,
    ...claims,
  });
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKey)
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

export function activityRequest(
  activity: Record<string, unknown>,
  options: { token?: string | null } = {},
): InboundHttpRequest {
  const token = options.token === undefined ? botToken() : options.token;
  return {
    method: 'POST',
    url: 'https://factory.test/taps/teams',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(activity),
  };
}

let nextId = 1_700_000_000_000;

export function channelMessage(input: {
  userId: string;
  channel?: string;
  root: string;
  text: string;
  tenant?: string;
  id?: string;
}): Record<string, unknown> {
  const channel = input.channel ?? CHANNEL;
  return {
    type: 'message',
    id: input.id ?? String(++nextId),
    text: input.text,
    serviceUrl: SERVICE_URL,
    from: { id: `29:${input.userId}`, aadObjectId: input.userId },
    conversation: {
      id: `${channel};messageid=${input.root}`,
      conversationType: 'channel',
      isGroup: true,
    },
    channelData: {
      tenant: { id: input.tenant ?? TENANT },
      channel: { id: channel },
      team: { id: channel },
    },
  };
}

/** Microsoft's key endpoints, the token endpoint and a Bot Connector that records replies. */
export function fakeMicrosoft(options: { failSend?: boolean } = {}) {
  const replies: { url: string; body: Record<string, unknown>; auth: string | undefined }[] = [];
  let keyFetches = 0;
  let tokenRequests = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/openidconfiguration')) {
      return Response.json({ jwks_uri: 'https://login.botframework.com/v1/.well-known/keys' });
    }
    if (url.endsWith('/.well-known/keys')) {
      keyFetches++;
      return Response.json({ keys: [jwk] });
    }
    if (url.includes('login.microsoftonline.com')) {
      tokenRequests++;
      return Response.json({ access_token: `bot-token-${tokenRequests}`, expires_in: 3600 });
    }
    if (options.failSend) return new Response('Forbidden', { status: 403 });
    replies.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      auth: (init?.headers as Record<string, string>).authorization,
    });
    return Response.json({ id: 'reply' }, { status: 201 });
  }) as typeof fetch;
  return {
    fetch: fetchImpl,
    replies,
    keyFetches: () => keyFetches,
    tokenRequests: () => tokenRequests,
  };
}
