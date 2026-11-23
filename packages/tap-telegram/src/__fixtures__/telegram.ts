import type { InboundHttpRequest } from '@anbiq/core';

export const SECRET = 'telegram-secret-token-0123456789abcdef';
export const NOW = new Date('2026-11-24T09:00:00Z');

let nextId = 100;

/** A Telegram update as the Bot API posts it to a webhook. */
export function update(
  message: Record<string, unknown> | null,
  options: { secret?: string | null } = {},
): InboundHttpRequest {
  const secret = options.secret === undefined ? SECRET : options.secret;
  const body = JSON.stringify({ update_id: ++nextId, ...(message ? { message } : {}) });
  return {
    method: 'POST',
    url: 'https://factory.test/taps/telegram',
    headers: {
      'content-type': 'application/json',
      ...(secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret }),
    },
    body,
  };
}

export function textMessage(input: {
  userId: string;
  chat: string;
  text: string;
  messageId?: number;
  replyTo?: number;
  isBot?: boolean;
}): Record<string, unknown> {
  return {
    message_id: input.messageId ?? ++nextId,
    from: { id: Number(input.userId.replace(/\D/g, '') || 1), is_bot: input.isBot ?? false },
    chat: { id: Number(input.chat) },
    date: Math.floor(NOW.getTime() / 1000),
    text: input.text,
    ...(input.replyTo === undefined ? {} : { reply_to_message: { message_id: input.replyTo } }),
  };
}

/** A fake Bot API that records sendMessage calls and gives each sent message an ID. */
export function fakeBotApi(reply: { ok: boolean; description?: string } = { ok: true }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let sentId = 5000;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const body = reply.ok ? { ok: true, result: { message_id: ++sentId } } : reply;
    return new Response(JSON.stringify(body), { status: reply.ok ? 200 : 400 });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
