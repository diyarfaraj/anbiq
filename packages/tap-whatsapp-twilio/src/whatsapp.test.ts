import { describe, expect, it } from 'vitest';
import { chunkText, createFactory, parseConfig } from '@anbiq/core';
import { FakeEngine, FakeGitHost, FakeRunner, FakeTracker, MemoryJobStore } from '@anbiq/testkit';
import { InMemoryConversationMemory, MESSAGE_LIMIT, WhatsAppTap, renderText } from './index.js';
import {
  AUTH_TOKEN,
  NOW,
  WEBHOOK_URL,
  fakeTwilioApi,
  inbound,
  twilioRequest,
} from './__fixtures__/twilio.js';

function tapWith(
  options: { api?: ReturnType<typeof fakeTwilioApi>; now?: () => Date; template?: string } = {},
) {
  const api = options.api ?? fakeTwilioApi();
  const memory = new InMemoryConversationMemory();
  const tap = new WhatsAppTap({
    accountSid: 'AC123',
    authToken: AUTH_TOKEN,
    from: '+15550100',
    webhookUrl: WEBHOOK_URL,
    memory,
    fetch: api.fetch,
    now: options.now ?? (() => NOW),
    ...(options.template ? { templateContentSid: options.template } : {}),
  });
  return { tap, api, memory };
}

describe('verify', () => {
  it('checks the signature against the configured public URL, not the URL the request arrived on', async () => {
    const { tap } = tapWith();
    const signedForOtherUrl = twilioRequest(inbound({ from: '+1555', text: 'hi' }), {
      url: 'http://internal:8080/x',
    });
    expect(await tap.verify(signedForOtherUrl)).toBe(false);
  });

  it('rejects a request signed with another token', async () => {
    const { tap } = tapWith();
    expect(
      await tap.verify(twilioRequest(inbound({ from: '+1555', text: 'hi' }), { token: 'other' })),
    ).toBe(false);
  });
});

describe('parse', () => {
  it('uses the phone number as the identity and the message as a new conversation', async () => {
    const { tap } = tapWith();
    const params = inbound({ from: '+15550123', text: '  Add a copy-link button ' });
    const message = await tap.parse(twilioRequest(params));
    expect(message).toMatchObject({
      userId: '+15550123',
      text: 'Add a copy-link button',
      messageId: params.MessageSid,
      thread: { tap: 'whatsapp-twilio', channel: 'whatsapp:+15550123', thread: params.MessageSid },
    });
  });

  it('puts a reply to one of the factory messages into that job', async () => {
    const { tap, api } = tapWith();
    const first = await tap.parse(
      twilioRequest(inbound({ from: '+15550123', text: 'Add a button' })),
    );
    await tap.send(first!.thread, { title: 'Started acme-1' });
    const sentSid = api.calls[0]!.sid;

    const reply = await tap.parse(
      twilioRequest(inbound({ from: '+15550123', text: 'status', repliedTo: sentSid })),
    );
    expect(reply?.thread).toEqual(first?.thread);
  });

  it('treats a reply to an unknown message as a new conversation', async () => {
    const { tap } = tapWith();
    const params = inbound({ from: '+15550123', text: 'merge', repliedTo: 'SM_UNKNOWN' });
    expect((await tap.parse(twilioRequest(params)))?.thread.thread).toBe(params.MessageSid);
  });

  it('ignores media-only messages', async () => {
    const { tap } = tapWith();
    expect(
      await tap.parse(twilioRequest({ ...inbound({ from: '+1555', text: '' }), NumMedia: '1' })),
    ).toBeNull();
  });
});

describe('send', () => {
  it('sends from the factory number to the person, authenticated with the account', async () => {
    const { tap, api } = tapWith();
    await tap.send(
      { tap: 'whatsapp-twilio', channel: 'whatsapp:+15550123', thread: 'SM1' },
      { title: 'Hi' },
    );
    expect(api.calls[0]?.url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
    );
    expect(api.calls[0]?.form).toMatchObject({
      From: 'whatsapp:+15550100',
      To: 'whatsapp:+15550123',
      Body: '*Hi*',
    });
    expect(api.calls[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from(`AC123:${AUTH_TOKEN}`).toString('base64')}`,
    );
  });

  it('splits long messages into parts WhatsApp accepts, and maps every part back to the job', async () => {
    const { tap, api, memory } = tapWith();
    const thread = { tap: 'whatsapp-twilio', channel: 'whatsapp:+15550123', thread: 'SM_JOB' };
    await tap.send(thread, { title: 'Long', body: 'line\n'.repeat(1000) });
    expect(api.calls.length).toBeGreaterThan(1);
    for (const call of api.calls) {
      expect(call.form.Body!.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
      expect(await memory.get(`sent:${call.sid}`)).toBe('SM_JOB');
    }
  });

  it('uses the approved template outside the 24-hour window', async () => {
    let now = NOW;
    const { tap, api } = tapWith({ now: () => now, template: 'HX123' });
    const message = await tap.parse(
      twilioRequest(inbound({ from: '+15550123', text: 'Add a button' })),
    );
    now = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);

    await tap.send(message!.thread, { title: 'acme-1 is ready for your review', body: 'details' });
    expect(api.calls[0]?.form).toMatchObject({
      ContentSid: 'HX123',
      ContentVariables: '{"1":"acme-1 is ready for your review"}',
    });
    expect(api.calls[0]?.form.Body).toBeUndefined();
  });

  it('sends free-form messages inside the window even when a template is configured', async () => {
    const { tap, api } = tapWith({ template: 'HX123' });
    const message = await tap.parse(
      twilioRequest(inbound({ from: '+15550123', text: 'Add a button' })),
    );
    await tap.send(message!.thread, { title: 'Started' });
    expect(api.calls[0]?.form.Body).toBe('*Started*');
  });

  it('throws when Twilio refuses the message', async () => {
    const { tap } = tapWith({ api: fakeTwilioApi({ status: 400, message: 'Invalid To number' }) });
    await expect(
      tap.send({ tap: 'whatsapp-twilio', channel: 'whatsapp:+1', thread: 'SM1' }, { title: 'x' }),
    ).rejects.toThrow(/Invalid To number/);
  });
});

describe('renderText', () => {
  it('turns suggested replies into instructions, since WhatsApp has no buttons here', () => {
    const text = renderText({
      title: 'Ready',
      actions: [
        { label: 'Merge', command: 'merge' },
        { label: 'Revise', command: 'revise: ' },
      ],
    });
    expect(text).toContain('Reply to this message with: merge or revise:');
  });

  it('lists fields and links on their own lines', () => {
    const text = renderText({
      title: 't',
      fields: [{ label: 'Stage', value: 'build' }],
      links: [{ label: 'Pull request', url: 'https://git.test/pulls/1' }],
    });
    expect(text).toContain('Stage: build');
    expect(text).toContain('Pull request: https://git.test/pulls/1');
  });

  it('chunks prefer line breaks', () => {
    expect(chunkText('aaaa\nbbbb', 6)).toEqual(['aaaa', 'bbbb']);
  });
});

describe('with the factory', () => {
  const yaml = `
project: acme
taps:
  whatsapp-twilio: { number: '+15550100' }
people:
  - name: Owner
    ids: { whatsapp-twilio: '+15550123' }
    roles: [requester, approver]
tracker: fake
git_host: fake
runner: fake
engine: { id: fake-engine }
checks: { verify: ['pnpm test'] }
budgets: { usd_per_day: 25, jobs_per_day: 10, concurrent_jobs: 1 }
`;

  it('starts a job, then routes a reply to the factory message into that job', async () => {
    const parsed = parseConfig(yaml);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    const { tap, api } = tapWith();
    const tracker = new FakeTracker();
    const factory = createFactory({
      config: parsed.config,
      taps: [tap],
      tracker,
      gitHost: new FakeGitHost(),
      runner: new FakeRunner(),
      engine: new FakeEngine(),
      store: new MemoryJobStore(),
    });

    const response = await factory.handleHttp(
      'whatsapp-twilio',
      twilioRequest(inbound({ from: '+15550123', text: 'Add a button' })),
    );
    expect(response).toEqual({
      status: 200,
      body: '<Response></Response>',
      contentType: 'text/xml',
    });
    expect(tracker.issues.size).toBe(1);

    const started = api.calls.at(-1)!;
    await factory.handleHttp(
      'whatsapp-twilio',
      twilioRequest(inbound({ from: '+15550123', text: 'status', repliedTo: started.sid })),
    );
    expect(tracker.issues.size).toBe(1);
    expect(api.calls.at(-1)?.form.Body).toMatch(/^\*acme-.*: Add a button\*/);
  });
});
