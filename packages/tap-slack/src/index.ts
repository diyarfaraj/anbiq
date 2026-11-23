import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  HttpResponse,
  InboundHttpRequest,
  InboundMessage,
  OutboundMessage,
  Tap,
  TapCapabilities,
  ThreadRef,
} from '@anbiq/core';
import { SECTION_LIMIT, render } from './render.js';

export interface SlackTapOptions {
  /** The app's signing secret, used to verify every request from Slack. */
  signingSecret: string;
  /** A bot token with the chat:write scope. */
  botToken: string;
  /** Channel IDs the factory listens in. Messages anywhere else are ignored. */
  channels: string[];
  /** Override for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Override for tests; defaults to the current time. */
  now?: () => Date;
}

/** Slack rejects requests older than this to stop replays; so does this tap. */
const MAX_AGE_SECONDS = 5 * 60;
const MENTION = /<@[A-Z0-9]+>/g;

interface SlackEvent {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
}

interface SlackPayload {
  type?: string;
  challenge?: string;
  event?: SlackEvent;
}

export class SlackTap implements Tap {
  readonly id = 'slack';
  readonly capabilities: TapCapabilities = {
    threads: true,
    actions: false,
    editMessages: false,
    maxLength: SECTION_LIMIT,
  };

  private readonly fetch: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: SlackTapOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async verify(request: InboundHttpRequest): Promise<boolean> {
    const timestamp = header(request, 'x-slack-request-timestamp');
    const signature = header(request, 'x-slack-signature');
    if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;

    const age = Math.abs(this.now().getTime() / 1000 - Number(timestamp));
    if (age > MAX_AGE_SECONDS) return false;

    const expected = `v0=${createHmac('sha256', this.options.signingSecret)
      .update(`v0:${timestamp}:${request.body}`)
      .digest('hex')}`;
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  async handshake(request: InboundHttpRequest): Promise<HttpResponse | null> {
    const payload = readPayload(request);
    if (payload?.type !== 'url_verification' || typeof payload.challenge !== 'string') return null;
    return { status: 200, body: payload.challenge, contentType: 'text/plain' };
  }

  async parse(request: InboundHttpRequest): Promise<InboundMessage | null> {
    const payload = readPayload(request);
    if (payload?.type !== 'event_callback' || !payload.event) return null;

    const event = payload.event;
    const isUserMessage = event.type === 'message' || event.type === 'app_mention';
    // Bot messages (including the factory's own replies), edits and joins carry a bot_id or a subtype.
    if (!isUserMessage || event.bot_id || event.subtype) return null;
    if (!event.user || !event.channel || !event.ts || typeof event.text !== 'string') return null;
    if (!this.options.channels.includes(event.channel)) return null;

    return {
      tap: this.id,
      // A mention in a channel arrives as both a message and an app_mention event with the same ts.
      messageId: `${event.channel}:${event.ts}`,
      userId: event.user,
      thread: { tap: this.id, channel: event.channel, thread: event.thread_ts ?? event.ts },
      text: event.text.replace(MENTION, '').trim(),
      receivedAt: this.now().toISOString(),
    };
  }

  async send(thread: ThreadRef, message: OutboundMessage): Promise<void> {
    const { text, blocks } = render(message);
    const response = await this.fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.botToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: thread.channel,
        thread_ts: thread.thread,
        text,
        blocks,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || result.ok !== true) {
      throw new Error(
        `Slack chat.postMessage failed: ${result.error ?? `HTTP ${response.status}`}`,
      );
    }
  }
}

function header(request: InboundHttpRequest, name: string): string | undefined {
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function readPayload(request: InboundHttpRequest): SlackPayload | null {
  try {
    const parsed: unknown = JSON.parse(request.body);
    return parsed !== null && typeof parsed === 'object' ? (parsed as SlackPayload) : null;
  } catch {
    return null;
  }
}

export { render } from './render.js';
