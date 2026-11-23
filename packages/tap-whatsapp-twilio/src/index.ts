import { createHmac, timingSafeEqual } from 'node:crypto';
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

export { InMemoryConversationMemory } from '@anbiq/core';
export type { ConversationMemory } from '@anbiq/core';

export interface WhatsAppTapOptions {
  accountSid: string;
  authToken: string;
  /** The factory's WhatsApp number in E.164 form, for example "+15550100". */
  from: string;
  /** The exact public URL Twilio calls. Twilio signs this URL, so it must match character for character. */
  webhookUrl: string;
  memory?: ConversationMemory;
  /**
   * An approved WhatsApp template (Twilio Content SID) to send outside the 24-hour window,
   * when free-form messages are not allowed. Variable {{1}} receives the message title.
   */
  templateContentSid?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Twilio's maximum length for one WhatsApp message body. */
export const MESSAGE_LIMIT = 1600;
const REPLY_WINDOW_HOURS = 24;
const PREFIX = 'whatsapp:';

export class WhatsAppTap implements Tap {
  readonly id = 'whatsapp-twilio';
  readonly capabilities: TapCapabilities = {
    threads: false,
    actions: false,
    editMessages: false,
    maxLength: MESSAGE_LIMIT,
    replyWindowHours: REPLY_WINDOW_HOURS,
  };
  /** Twilio expects TwiML back; an empty response sends no automatic reply. */
  readonly acknowledgement: HttpResponse = {
    status: 200,
    body: '<Response></Response>',
    contentType: 'text/xml',
  };

  private readonly memory: ConversationMemory;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: WhatsAppTapOptions) {
    this.memory = options.memory ?? new InMemoryConversationMemory();
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async verify(request: InboundHttpRequest): Promise<boolean> {
    const signature = requestHeader(request, 'x-twilio-signature');
    if (!signature) return false;
    const params = new URLSearchParams(request.body);
    const signed = [...new Set(params.keys())]
      .sort()
      .reduce((data, key) => data + key + (params.get(key) ?? ''), this.options.webhookUrl);
    const expected = createHmac('sha1', this.options.authToken).update(signed).digest('base64');
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  async parse(request: InboundHttpRequest): Promise<InboundMessage | null> {
    const params = new URLSearchParams(request.body);
    const messageSid = params.get('MessageSid');
    const from = params.get('From');
    const body = params.get('Body')?.trim();
    // Delivery status callbacks and media-only messages carry no text to act on.
    if (!messageSid || !from?.startsWith(PREFIX) || !body || params.has('MessageStatus')) {
      return null;
    }

    // WhatsApp has no threads. A reply to one of the factory's messages belongs to that job;
    // any other message starts a new conversation.
    const repliedTo = params.get('OriginalRepliedMessageSid');
    const thread = (repliedTo && (await this.memory.get(`sent:${repliedTo}`))) || messageSid;
    await this.memory.set(`inbound:${from}`, this.now().toISOString());

    return {
      tap: this.id,
      messageId: messageSid,
      userId: from.slice(PREFIX.length),
      thread: { tap: this.id, channel: from, thread },
      text: body,
      receivedAt: this.now().toISOString(),
    };
  }

  async send(thread: ThreadRef, message: OutboundMessage): Promise<void> {
    if (this.options.templateContentSid && (await this.outsideReplyWindow(thread.channel))) {
      await this.post(thread, {
        ContentSid: this.options.templateContentSid,
        ContentVariables: JSON.stringify({ 1: message.title.slice(0, 1000) }),
      });
      return;
    }
    for (const piece of chunkText(renderText(message), MESSAGE_LIMIT)) {
      await this.post(thread, { Body: piece });
    }
  }

  private async outsideReplyWindow(channel: string): Promise<boolean> {
    const last = await this.memory.get(`inbound:${channel}`);
    if (!last) return true;
    return this.now().getTime() - Date.parse(last) > REPLY_WINDOW_HOURS * 60 * 60 * 1000;
  }

  private async post(thread: ThreadRef, fields: Record<string, string>): Promise<void> {
    const { accountSid, authToken, from } = this.options;
    const response = await this.fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: `${PREFIX}${from}`,
          To: thread.channel,
          ...fields,
        }).toString(),
      },
    );
    const result = (await response.json()) as { sid?: string; code?: number; message?: string };
    if (!response.ok || !result.sid) {
      throw new Error(`Twilio send failed: ${result.message ?? `HTTP ${response.status}`}`);
    }
    // Remember the message, so a WhatsApp reply to it finds its way back to the job.
    await this.memory.set(`sent:${result.sid}`, thread.thread);
  }
}

/** Plain text with WhatsApp's light formatting. Suggested replies become instructions. */
export function renderText(message: OutboundMessage): string {
  return renderPlainText(message, { bold: (text) => `*${text}*` });
}
