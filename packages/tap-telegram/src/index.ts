import { timingSafeEqual } from 'node:crypto';
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

export interface TelegramTapOptions {
  /** The bot token from @BotFather. */
  botToken: string;
  /**
   * The secret_token given to setWebhook. Telegram sends it in a header on every update;
   * use at least 32 random characters (A-Z, a-z, 0-9, _ and -).
   */
  secretToken: string;
  /** Chat IDs the factory listens in, as strings. Messages from any other chat are ignored. */
  chats: string[];
  /** The bot's username without "@", so mentions in group chats can be removed from requests. */
  botUsername?: string;
  memory?: ConversationMemory;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Sent in a private chat when a message is neither a request nor a reply about a job. */
export const HINT =
  'To request a change, send /anbiq followed by what you want, for example: /anbiq Add a dark mode toggle. To act on a job, reply to one of my messages about it.';

/** Telegram's maximum length for one message. */
export const MESSAGE_LIMIT = 4096;

interface TelegramMessage {
  message_id: number;
  from?: { id: number; is_bot?: boolean };
  chat: { id: number; type?: string };
  text?: string;
  reply_to_message?: { message_id: number };
}

export class TelegramTap implements Tap {
  readonly id = 'telegram';
  readonly capabilities: TapCapabilities = {
    threads: false,
    actions: false,
    editMessages: false,
    maxLength: MESSAGE_LIMIT,
  };

  private readonly memory: ConversationMemory;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private readonly chats: Set<string>;

  constructor(private readonly options: TelegramTapOptions) {
    this.memory = options.memory ?? new InMemoryConversationMemory();
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.chats = new Set(options.chats);
  }

  /**
   * Telegram authenticates webhooks with the secret token header only; it does not sign the
   * body. HTTPS protects the body in transit.
   */
  async verify(request: InboundHttpRequest): Promise<boolean> {
    const given = requestHeader(request, 'x-telegram-bot-api-secret-token');
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(this.options.secretToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async parse(request: InboundHttpRequest): Promise<InboundMessage | null> {
    let update: { message?: TelegramMessage };
    try {
      update = JSON.parse(request.body) as { message?: TelegramMessage };
    } catch {
      return null;
    }
    // Edits, channel posts, joins and other updates are not requests.
    const message = update.message;
    if (!message?.from || message.from.is_bot || typeof message.text !== 'string') return null;
    const chat = String(message.chat.id);
    if (!this.chats.has(chat)) return null;
    const text = this.withoutBotAddress(message.text);

    // Telegram has no threads. A reply to a message the factory knows belongs to that
    // message's job. Anything else starts a new job only when it is addressed to the bot
    // ("/anbiq …" or "@bot …"), so greetings and stray messages never become work.
    const repliedTo = message.reply_to_message?.message_id;
    const known =
      repliedTo === undefined ? undefined : await this.memory.get(`telegram:${chat}:${repliedTo}`);
    const addressed = text !== message.text.trim();
    if (!text || (!known && !addressed)) {
      if (message.chat.type === 'private') await this.hint(chat, message.message_id);
      return null;
    }
    const thread = known || String(message.message_id);
    await this.memory.set(`telegram:${chat}:${message.message_id}`, thread);

    return {
      tap: this.id,
      messageId: `${chat}:${message.message_id}`,
      userId: String(message.from.id),
      thread: { tap: this.id, channel: chat, thread },
      text,
      receivedAt: this.now().toISOString(),
    };
  }

  async send(thread: ThreadRef, message: OutboundMessage): Promise<void> {
    const text = renderPlainText(message);
    for (const piece of chunkText(text, MESSAGE_LIMIT)) {
      const response = await this.fetch(
        `https://api.telegram.org/bot${this.options.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: thread.channel,
            text: piece,
            reply_parameters: {
              message_id: Number(thread.thread),
              allow_sending_without_reply: true,
            },
            link_preview_options: { is_disabled: true },
          }),
        },
      );
      const result = (await response.json()) as {
        ok: boolean;
        result?: { message_id: number };
        description?: string;
      };
      if (!result.ok || !result.result) {
        throw new Error(`Telegram send failed: ${result.description ?? `HTTP ${response.status}`}`);
      }
      // Remember the message, so a reply to it finds its way back to the job.
      await this.memory.set(
        `telegram:${thread.channel}:${result.result.message_id}`,
        thread.thread,
      );
    }
  }

  /** Explains how to make a request. Best effort: a failed hint must not fail the webhook. */
  private async hint(chat: string, messageId: number): Promise<void> {
    try {
      await this.fetch(`https://api.telegram.org/bot${this.options.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: HINT,
          reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
        }),
      });
    } catch {
      // Nothing to do: the person can still send /anbiq.
    }
  }

  /** People write "/anbiq …" or "@bot …"; the request is the rest. */
  private withoutBotAddress(text: string): string {
    const name = this.options.botUsername;
    let rest = text.trim().replace(/^\/anbiq(@\w+)?(\s+|$)/i, '');
    if (name) rest = rest.replace(new RegExp(`^@${escapeRegExp(name)}\\b[\\s,:]*`, 'i'), '');
    return rest.trim();
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
