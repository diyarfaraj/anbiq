import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  InboundHttpRequest,
  InboundMessage,
  OutboundMessage,
  Tap,
  TapCapabilities,
  ThreadRef,
} from '@anbiq/core';

export interface FakeMessageInput {
  userId: string;
  channel: string;
  thread: string;
  text: string;
  messageId?: string;
}

const SIGNATURE_HEADER = 'x-fake-signature';

/** A tap that signs its webhook bodies with HMAC-SHA256, the way most chat platforms do. */
export class FakeTap implements Tap {
  readonly sent: { thread: ThreadRef; message: OutboundMessage }[] = [];
  private counter = 0;

  constructor(
    readonly id: string,
    private readonly secret: string,
    readonly capabilities: TapCapabilities = {
      threads: true,
      actions: true,
      editMessages: false,
      maxLength: 4000,
    },
  ) {}

  async verify(request: InboundHttpRequest): Promise<boolean> {
    const given = request.headers[SIGNATURE_HEADER];
    if (!given) return false;
    const expected = this.sign(request.body);
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async parse(request: InboundHttpRequest): Promise<InboundMessage | null> {
    const payload = JSON.parse(request.body) as { type: string } & Partial<FakeMessageInput>;
    if (payload.type !== 'message' || !payload.userId || !payload.channel || !payload.thread) {
      return null;
    }
    return {
      tap: this.id,
      messageId: payload.messageId ?? `m${++this.counter}`,
      userId: payload.userId,
      thread: { tap: this.id, channel: payload.channel, thread: payload.thread },
      text: payload.text ?? '',
      receivedAt: new Date().toISOString(),
    };
  }

  async send(thread: ThreadRef, message: OutboundMessage): Promise<void> {
    this.sent.push({ thread, message });
  }

  /** A correctly signed webhook request carrying a user message. */
  signedRequest(input: FakeMessageInput): InboundHttpRequest {
    const body = JSON.stringify({ type: 'message', ...input });
    return this.request(body, this.sign(body));
  }

  unsignedRequest(input: FakeMessageInput): InboundHttpRequest {
    const body = JSON.stringify({ type: 'message', ...input });
    return { method: 'POST', url: `https://factory.test/taps/${this.id}`, headers: {}, body };
  }

  /** A platform event that is not a message, such as a URL verification ping. */
  nonMessageRequest(): InboundHttpRequest {
    const body = JSON.stringify({ type: 'ping' });
    return this.request(body, this.sign(body));
  }

  /** The text of everything sent to a thread, titles first. */
  transcript(thread?: string): string[] {
    return this.sent
      .filter((entry) => thread === undefined || entry.thread.thread === thread)
      .map((entry) => entry.message.title);
  }

  private request(body: string, signature: string): InboundHttpRequest {
    return {
      method: 'POST',
      url: `https://factory.test/taps/${this.id}`,
      headers: { [SIGNATURE_HEADER]: signature },
      body,
    };
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }
}
