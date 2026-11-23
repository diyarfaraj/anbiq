import { createPublicKey, verify as verifySignature } from 'node:crypto';
import {
  InMemoryConversationMemory,
  chunkText,
  renderPlainText,
  requestHeader,
  type ConversationMemory,
  type InboundHttpRequest,
  type InboundMessage,
  type OutboundMessage,
  type Tap,
  type TapCapabilities,
  type ThreadRef,
} from '@anbiq/core';

export interface TeamsTapOptions {
  /** The bot's Microsoft App ID (client ID). */
  appId: string;
  /** A client secret for that app registration. */
  appPassword: string;
  /** The Microsoft Entra tenant the bot belongs to. Activities from other tenants are ignored. */
  tenantId: string;
  /** Team channel IDs ("19:…@thread.tacv2") the factory listens in. */
  channels: string[];
  memory?: ConversationMemory;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Long enough for any factory message, well under Teams' 28 KB message limit. */
export const MESSAGE_LIMIT = 20_000;

const OPENID_CONFIG = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const ISSUER = 'https://api.botframework.com';
const KEY_CACHE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 5 * 60;

interface Activity {
  type?: string;
  id?: string;
  text?: string;
  serviceUrl?: string;
  from?: { id?: string; aadObjectId?: string };
  conversation?: { id?: string; conversationType?: string };
  channelData?: { tenant?: { id?: string }; channel?: { id?: string } };
}

// The JWK shape createPublicKey accepts, plus the Bot Framework's extra fields.
type Jwk = Extract<Parameters<typeof createPublicKey>[0], { format: 'jwk' }>['key'] & {
  kid?: string;
  endorsements?: string[];
};

/**
 * Microsoft Teams, through the Bot Framework. Works in team channels, where every post is a
 * thread: mention the bot in a new post to make a request, and reply in that post's thread to
 * act on the job.
 */
export class TeamsTap implements Tap {
  readonly id = 'teams';
  readonly capabilities: TapCapabilities = {
    threads: true,
    actions: false,
    editMessages: false,
    maxLength: MESSAGE_LIMIT,
  };

  private readonly memory: ConversationMemory;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private readonly channels: Set<string>;
  private keys: { values: Jwk[]; fetchedAt: number } | undefined;
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly options: TeamsTapOptions) {
    this.memory = options.memory ?? new InMemoryConversationMemory();
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.channels = new Set(options.channels);
  }

  /**
   * Checks the Bot Framework's signed token: Microsoft's signing key, issuer, audience (this
   * bot), lifetime, and that it was issued for the service URL in the activity. The token
   * authenticates the sender; it does not sign the body, which HTTPS protects.
   */
  async verify(request: InboundHttpRequest): Promise<boolean> {
    const auth = requestHeader(request, 'authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) return false;
    const [encodedHeader, encodedClaims, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedClaims || !encodedSignature) return false;

    let header: { alg?: string; kid?: string };
    let claims: { iss?: string; aud?: string; exp?: number; nbf?: number; serviceurl?: string };
    let activity: Activity;
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString()) as typeof header;
      claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString()) as typeof claims;
      activity = JSON.parse(request.body) as Activity;
    } catch {
      return false;
    }
    if (header.alg !== 'RS256' || !header.kid) return false;

    const key = await this.signingKey(header.kid);
    if (!key) return false;
    if (key.endorsements && !key.endorsements.includes('msteams')) return false;
    const valid = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ key, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url'),
    );
    if (!valid) return false;

    const now = this.now().getTime() / 1000;
    return (
      claims.iss === ISSUER &&
      claims.aud === this.options.appId &&
      typeof claims.exp === 'number' &&
      claims.exp + CLOCK_SKEW_SECONDS > now &&
      (claims.nbf === undefined || claims.nbf - CLOCK_SKEW_SECONDS < now) &&
      typeof activity.serviceUrl === 'string' &&
      sameServiceUrl(claims.serviceurl, activity.serviceUrl)
    );
  }

  async parse(request: InboundHttpRequest): Promise<InboundMessage | null> {
    let activity: Activity;
    try {
      activity = JSON.parse(request.body) as Activity;
    } catch {
      return null;
    }
    if (activity.type !== 'message' || activity.conversation?.conversationType !== 'channel') {
      return null;
    }
    if (activity.channelData?.tenant?.id !== this.options.tenantId) return null;
    const [base, root] = splitConversation(activity.conversation.id);
    const channel = activity.channelData?.channel?.id ?? base;
    const userId = activity.from?.aadObjectId;
    const text = cleanText(activity.text ?? '');
    if (!base || !root || !channel || !this.channels.has(channel) || !userId || !activity.id) {
      return null;
    }
    if (!text || !activity.serviceUrl?.startsWith('https://')) return null;

    await this.memory.set(`teams:serviceUrl:${base}`, activity.serviceUrl);
    return {
      tap: this.id,
      messageId: activity.id,
      userId,
      thread: { tap: this.id, channel: base, thread: root },
      text,
      receivedAt: this.now().toISOString(),
    };
  }

  async send(thread: ThreadRef, message: OutboundMessage): Promise<void> {
    const serviceUrl = await this.memory.get(`teams:serviceUrl:${thread.channel}`);
    if (!serviceUrl) throw new Error(`no Teams service URL is known for ${thread.channel}`);
    const conversation = encodeURIComponent(`${thread.channel};messageid=${thread.thread}`);
    const url = `${serviceUrl.replace(/\/$/, '')}/v3/conversations/${conversation}/activities`;
    for (const piece of chunkText(
      renderPlainText(message, { replyHint: 'Reply in this thread with' }),
      MESSAGE_LIMIT,
    )) {
      const response = await this.fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type: 'message', text: piece, textFormat: 'plain' }),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        throw new Error(`Teams send failed: HTTP ${response.status} ${detail}`);
      }
    }
  }

  private async signingKey(kid: string): Promise<Jwk | undefined> {
    const stale = !this.keys || this.now().getTime() - this.keys.fetchedAt > KEY_CACHE_MS;
    if (stale || !this.keys?.values.some((key) => key.kid === kid)) await this.refreshKeys();
    return this.keys?.values.find((key) => key.kid === kid);
  }

  private async refreshKeys(): Promise<void> {
    const config = (await (await this.fetch(OPENID_CONFIG)).json()) as { jwks_uri?: string };
    if (!config.jwks_uri?.startsWith('https://login.botframework.com/')) return;
    const { keys } = (await (await this.fetch(config.jwks_uri)).json()) as { keys?: Jwk[] };
    this.keys = { values: keys ?? [], fetchedAt: this.now().getTime() };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now().getTime()) return this.token.value;
    const response = await this.fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.options.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.options.appId,
          client_secret: this.options.appPassword,
          scope: 'https://api.botframework.com/.default',
        }).toString(),
      },
    );
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new Error(
        `Teams token request failed: ${body.error_description ?? `HTTP ${response.status}`}`,
      );
    }
    this.token = {
      value: body.access_token,
      expiresAt: this.now().getTime() + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }
}

/** "19:abc@thread.tacv2;messageid=123" → ["19:abc@thread.tacv2", "123"] */
function splitConversation(id: string | undefined): [string | undefined, string | undefined] {
  if (!id) return [undefined, undefined];
  const match = /^(.*);messageid=(\d+)$/.exec(id);
  return match ? [match[1], match[2]] : [id, undefined];
}

/** Teams sends channel posts as HTML, with the bot's mention as <at>Name</at>. */
function cleanText(html: string): string {
  return html
    .replace(/<at>[^<]*<\/at>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sameServiceUrl(claim: string | undefined, actual: string): boolean {
  if (!claim) return false;
  const normalise = (url: string) => url.replace(/\/+$/, '').toLowerCase();
  return normalise(claim) === normalise(actual);
}
