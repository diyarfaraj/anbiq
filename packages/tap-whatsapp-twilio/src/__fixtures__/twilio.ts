import { createHmac } from 'node:crypto';
import type { InboundHttpRequest } from '@anbiq/core';

export const AUTH_TOKEN = 'test-auth-token';
export const WEBHOOK_URL = 'https://factory.test/taps/whatsapp-twilio';
export const NOW = new Date('2026-11-24T09:00:00Z');

let sid = 0;

export function nextSid(): string {
  return `SM${String(++sid).padStart(32, '0')}`;
}

/** A Twilio webhook request, signed the way Twilio signs it. */
export function twilioRequest(
  params: Record<string, string>,
  options: { token?: string | null; url?: string } = {},
): InboundHttpRequest {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  const token = options.token === undefined ? AUTH_TOKEN : options.token;
  if (token !== null) {
    const data = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], options.url ?? WEBHOOK_URL);
    headers['X-Twilio-Signature'] = createHmac('sha1', token).update(data).digest('base64');
  }
  return { method: 'POST', url: WEBHOOK_URL, headers, body };
}

export function inbound(input: {
  from: string;
  text: string;
  repliedTo?: string;
  messageSid?: string;
}): Record<string, string> {
  return {
    MessageSid: input.messageSid ?? nextSid(),
    AccountSid: 'AC123',
    From: `whatsapp:${input.from}`,
    To: 'whatsapp:+15550100',
    Body: input.text,
    NumMedia: '0',
    ...(input.repliedTo ? { OriginalRepliedMessageSid: input.repliedTo } : {}),
  };
}

/** A fake Twilio Messages API that records sends and returns a new message SID for each. */
export function fakeTwilioApi(failWith?: { status: number; message: string }) {
  const calls: {
    url: string;
    headers: Record<string, string>;
    form: Record<string, string>;
    sid: string;
  }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    if (failWith) {
      return new Response(JSON.stringify({ code: 21211, message: failWith.message }), {
        status: failWith.status,
      });
    }
    const messageSid = nextSid();
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      form: Object.fromEntries(new URLSearchParams(String(init?.body))),
      sid: messageSid,
    });
    return new Response(JSON.stringify({ sid: messageSid }), { status: 201 });
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}
