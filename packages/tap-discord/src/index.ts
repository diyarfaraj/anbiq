import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import {
  InMemoryConversationMemory,
  chunkText,
  renderPlainText,
  requestHeader,
  type ConversationMemory,
  type HttpResponse,
  type InboundHttpRequest,
  type InboundMessage,
  type OutboundMessage,
  type Tap,
  type TapCapabilities,
  type ThreadRef,
} from '@anbiq/core';

export interface DiscordTapOptions {
  /** The application's public key (hex), from the Developer Portal's General Information page. */
  publicKey: string;
  /** The bot token, used to post replies and start threads. */
  botToken: string;
  /** Channel IDs where /anbiq may be used. Threads the factory started in them are included. */
  channels: string[];
  memory?: ConversationMemory;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Discord's maximum length for one message. */
export const MESSAGE_LIMIT = 2000;
/** The slash command people type. */
export const COMMAND_NAME = 'anbiq';

const API = 'https://discord.com/api/v10';
const MAX_AGE_SECONDS = 5 * 60;
const PING = 1;
const APPLICATION_COMMAND = 2;
/** DER prefix that turns a raw 32-byte Ed25519 key into an SPKI public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

interface Interaction {
  id: string;
  type: number;
  channel_id?: string;
  member?: { user?: { id: string; bot?: boolean } };
  user?: { id: string; bot?: boolean };
  data?: { name?: string; options?: { name: string; type: number; value?: unknown }[] };
}

/**
 * Discord sends ordinary messages to bots only over a persistent gateway connection, so this
 * tap works through a signed slash command instead: `/anbiq request: Add a button`. Each job
 * gets its own Discord thread, and commands inside it act on that job.
 */
export class DiscordTap implements Tap {
  readonly id = 'discord';
  readonly capabilities: TapCapabilities = {
    threads: true,
    actions: false,
    editMessages: false,
    maxLength: MESSAGE_LIMIT,
  };
  /** Discord requires an answer to every command within three seconds. */
  readonly acknowledgement: HttpResponse = {
    status: 200,
    body: JSON.stringify({
      type: 4,
      data: { content: 'Received.', allowed_mentions: { parse: [] } },
    }),
    contentType: 'application/json',
  };

  private readonly key: KeyObject;
  private readonly memory: ConversationMemory;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private readonly channels: Set<string>;

  constructor(private readonly options: DiscordTapOptions) {
    const raw = Buffer.from(options.publicKey, 'hex');
    if (raw.length !== 32) throw new Error('the Discord public key must be 64 hex characters');
    this.key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    this.memory = options.memory ?? new InMemoryConversationMemory();
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.channels = new Set(options.channels);
  }

  async verify(request: InboundHttpRequest): Promise<boolean> {
    const signature = requestHeader(request, 'x-signature-ed25519');
    const timestamp = requestHeader(request, 'x-signature-timestamp');
    if (
      !signature ||
      !timestamp ||
      !/^\d+$/.test(timestamp) ||
      !/^[0-9a-f]{128}$/i.test(signature)
    ) {
      return false;
    }
    if (Math.abs(this.now().getTime() / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
    return verifySignature(
      null,
      Buffer.from(timestamp + request.body),
      this.key,
      Buffer.from(signature, 'hex'),
    );
  }

  /** Discord checks the endpoint with a signed PING when it is saved, and now and then after. */
  async handshake(request: InboundHttpRequest): Promise<HttpResponse | null> {
    const interaction = parseJson(request.body);
    if (interaction?.type !== PING) return null;
    return { status: 200, body: JSON.stringify({ type: 1 }), contentType: 'application/json' };
  }

  async parse(request: InboundHttpRequest): Promise<InboundMessage | null> {
    const interaction = parseJson(request.body);
    if (interaction?.type !== APPLICATION_COMMAND || interaction.data?.name !== COMMAND_NAME) {
      return null;
    }
    const user = interaction.member?.user ?? interaction.user;
    const channel = interaction.channel_id;
    const text = interaction.data.options?.find((option) => option.name === 'request')?.value;
    if (!user || user.bot || !channel || typeof text !== 'string' || !text.trim()) return null;

    // Inside a thread the factory started, the command belongs to that thread's job.
    const known = await this.memory.get(`discord:thread:${channel}`);
    const thread: ThreadRef = known
      ? (JSON.parse(known) as ThreadRef)
      : { tap: this.id, channel, thread: interaction.id };
    if (!known && !this.channels.has(channel)) return null;

    return {
      tap: this.id,
      messageId: interaction.id,
      userId: user.id,
      thread,
      text: text.trim(),
      receivedAt: this.now().toISOString(),
    };
  }

  async send(thread: ThreadRef, message: OutboundMessage): Promise<void> {
    const pieces = chunkText(
      renderPlainText(message, { replyHint: 'Reply here with /anbiq' }),
      MESSAGE_LIMIT,
    );
    const jobKey = `discord:job:${thread.channel}:${thread.thread}`;
    let target = await this.memory.get(jobKey);

    if (!target) {
      // The first reply about a job starts its thread in the channel; the details go inside.
      const first = await this.post(thread.channel, message.title.slice(0, MESSAGE_LIMIT));
      const started = await this.call(`/channels/${thread.channel}/messages/${first}/threads`, {
        name: message.title.slice(0, 100),
        auto_archive_duration: 10080,
      });
      target = started.id;
      await this.memory.set(jobKey, target);
      await this.memory.set(`discord:thread:${target}`, JSON.stringify(thread));
    }
    for (const piece of pieces) await this.post(target, piece);
  }

  private async post(channel: string, content: string): Promise<string> {
    // No pings: text from requests and crews must never notify @everyone or anyone else.
    const result = await this.call(`/channels/${channel}/messages`, {
      content,
      allowed_mentions: { parse: [] },
    });
    return result.id;
  }

  private async call(path: string, body: unknown): Promise<{ id: string }> {
    const response = await this.fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${this.options.botToken}`,
        'content-type': 'application/json',
        'user-agent': 'DiscordBot (https://github.com/diyarfaraj/anbiq, 0.1)',
      },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { id?: string; message?: string };
    if (!response.ok || !result.id) {
      throw new Error(`Discord ${path} failed: ${result.message ?? `HTTP ${response.status}`}`);
    }
    return { id: result.id };
  }
}

/** The /anbiq command definition, for registering it with Discord. */
export const COMMAND_DEFINITION = {
  name: COMMAND_NAME,
  type: 1,
  description: 'Ask the software factory for work, or act on a job inside its thread',
  options: [
    {
      name: 'request',
      description: 'What you want built, or merge, revise: …, status, cancel, deploy <env>',
      type: 3,
      required: true,
      max_length: 4000,
    },
  ],
} as const;

/** Registers /anbiq for one server (instant) or globally (can take up to an hour). */
export async function registerCommand(input: {
  applicationId: string;
  botToken: string;
  guildId?: string;
  fetch?: typeof fetch;
}): Promise<void> {
  const scope = input.guildId ? `/guilds/${input.guildId}` : '';
  const response = await (input.fetch ?? fetch)(
    `${API}/applications/${input.applicationId}${scope}/commands`,
    {
      method: 'POST',
      headers: { authorization: `Bot ${input.botToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(COMMAND_DEFINITION),
    },
  );
  if (!response.ok) throw new Error(`Discord command registration failed: HTTP ${response.status}`);
}

function parseJson(body: string): Interaction | null {
  try {
    return JSON.parse(body) as Interaction;
  } catch {
    return null;
  }
}
