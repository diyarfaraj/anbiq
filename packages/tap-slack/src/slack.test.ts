import { describe, expect, it } from 'vitest';
import { createFactory, parseConfig } from '@anbiq/core';
import { FakeEngine, FakeGitHost, FakeRunner, FakeTracker, MemoryJobStore } from '@anbiq/testkit';
import { SlackTap } from './index.js';
import { SECTION_LIMIT, render } from './render.js';
import { NOW, SECRET, fakeSlackApi, messageEvent, slackRequest } from './__fixtures__/slack.js';

function tapWith(api = fakeSlackApi()) {
  const tap = new SlackTap({
    signingSecret: SECRET,
    botToken: 'xoxb-test',
    channels: ['C1'],
    fetch: api.fetch,
    now: () => NOW,
  });
  return { tap, api };
}

describe('verify', () => {
  it('rejects a correctly signed request that is more than five minutes old', async () => {
    const { tap } = tapWith();
    const old = slackRequest(messageEvent({ userId: 'U1', channel: 'C1', text: 'hi' }), {
      at: new Date(NOW.getTime() - 6 * 60 * 1000),
    });
    expect(await tap.verify(old)).toBe(false);
  });

  it('rejects a request signed with another secret', async () => {
    const { tap } = tapWith();
    const forged = slackRequest(messageEvent({ userId: 'U1', channel: 'C1', text: 'hi' }), {
      secret: 'wrong',
    });
    expect(await tap.verify(forged)).toBe(false);
  });

  it('reads the signature headers case-insensitively', async () => {
    const { tap } = tapWith();
    const request = slackRequest(messageEvent({ userId: 'U1', channel: 'C1', text: 'hi' }));
    const lower = Object.fromEntries(
      Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(await tap.verify({ ...request, headers: lower })).toBe(true);
  });
});

describe('handshake', () => {
  it("answers Slack's URL verification challenge", async () => {
    const { tap } = tapWith();
    const response = await tap.handshake(
      slackRequest({ type: 'url_verification', challenge: 'xyz' }),
    );
    expect(response).toEqual({ status: 200, body: 'xyz', contentType: 'text/plain' });
  });

  it('is not a handshake for ordinary events', async () => {
    const { tap } = tapWith();
    expect(
      await tap.handshake(slackRequest(messageEvent({ userId: 'U1', channel: 'C1', text: 'hi' }))),
    ).toBeNull();
  });
});

describe('parse', () => {
  it('starts a thread on a top-level message and strips the bot mention', async () => {
    const { tap } = tapWith();
    const message = await tap.parse(
      slackRequest(
        messageEvent({ userId: 'U1', channel: 'C1', text: '<@UBOT123> add a copy-link button' }),
      ),
    );
    expect(message?.text).toBe('add a copy-link button');
    expect(message?.thread.thread).toBe(message?.messageId.split(':')[1]);
  });

  it.each([
    ['a bot message, such as the factory replying to itself', { bot_id: 'B1' }],
    ['an edit', { subtype: 'message_changed' }],
    ['someone joining the channel', { subtype: 'channel_join' }],
  ])('ignores %s', async (_label, extra) => {
    const { tap } = tapWith();
    expect(
      await tap.parse(
        slackRequest(messageEvent({ userId: 'U1', channel: 'C1', text: 'x', extra })),
      ),
    ).toBeNull();
  });

  it('ignores channels the factory is not listening in', async () => {
    const { tap } = tapWith();
    expect(
      await tap.parse(slackRequest(messageEvent({ userId: 'U1', channel: 'C_OTHER', text: 'x' }))),
    ).toBeNull();
  });

  it('gives the message and app_mention events for one message the same ID', async () => {
    const { tap } = tapWith();
    const asMessage = messageEvent({ userId: 'U1', channel: 'C1', text: '<@UBOT> hi' }) as {
      event: Record<string, unknown>;
    };
    const asMention = { ...asMessage, event: { ...asMessage.event, type: 'app_mention' } };
    const first = await tap.parse(slackRequest(asMessage));
    const second = await tap.parse(slackRequest(asMention));
    expect(second?.messageId).toBe(first?.messageId);
  });

  it('returns null for a body that is not JSON', async () => {
    const { tap } = tapWith();
    expect(
      await tap.parse({ method: 'POST', url: '/', headers: {}, body: 'command=%2Ffactory' }),
    ).toBeNull();
  });
});

describe('send', () => {
  it('posts into the thread with the bot token', async () => {
    const { tap, api } = tapWith();
    await tap.send(
      { tap: 'slack', channel: 'C1', thread: '1700.0001' },
      { title: 'Started acme-1' },
    );
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.url).toBe('https://slack.com/api/chat.postMessage');
    expect(api.calls[0]?.headers.authorization).toBe('Bearer xoxb-test');
    expect(api.calls[0]?.body).toMatchObject({
      channel: 'C1',
      thread_ts: '1700.0001',
      text: 'Started acme-1',
    });
  });

  it('throws when Slack refuses the message', async () => {
    const { tap } = tapWith(fakeSlackApi({ ok: false, error: 'not_in_channel' }));
    await expect(
      tap.send({ tap: 'slack', channel: 'C1', thread: '1' }, { title: 'x' }),
    ).rejects.toThrow(/not_in_channel/);
  });
});

describe('render', () => {
  it('escapes Slack markup in text from people and agents', () => {
    const { blocks } = render({ title: 'Use <b> & <script>' });
    expect(JSON.stringify(blocks)).toContain('Use &lt;b&gt; &amp; &lt;script&gt;');
  });

  it('splits a long body into sections Slack accepts', () => {
    const { blocks } = render({ title: 't', body: 'line\n'.repeat(1500) });
    const sections = blocks.filter((block) => block.type === 'section').slice(1);
    expect(sections.length).toBeGreaterThan(1);
    for (const block of sections) {
      expect((block.text as { text: string }).text.length).toBeLessThanOrEqual(SECTION_LIMIT);
    }
  });

  it('shows suggested replies as text, since the tap has no buttons yet', () => {
    const { blocks } = render({
      title: 't',
      actions: [
        { label: 'Merge', command: 'merge' },
        { label: 'Revise', command: 'revise: ' },
      ],
    });
    expect(JSON.stringify(blocks.at(-1))).toContain('Reply `merge` or `revise:`');
  });

  it('keeps at most ten fields', () => {
    const fields = Array.from({ length: 12 }, (_, i) => ({ label: `f${i}`, value: 'v' }));
    const { blocks } = render({ title: 't', fields });
    const fieldBlock = blocks.find((block) => Array.isArray(block.fields));
    expect((fieldBlock?.fields as unknown[]).length).toBe(10);
  });
});

describe('with the factory', () => {
  const yaml = `
project: acme
taps:
  slack: { channels: [C1] }
people:
  - name: Owner
    ids: { slack: U_OWNER }
    roles: [requester, approver]
tracker: fake
git_host: fake
runner: fake
engine: { id: fake-engine }
checks: { verify: ['pnpm test'] }
budgets: { usd_per_day: 25, jobs_per_day: 10, concurrent_jobs: 1 }
`;

  function factoryWithSlack() {
    const parsed = parseConfig(yaml);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    const { tap, api } = tapWith();
    const runner = new FakeRunner();
    const tracker = new FakeTracker();
    const factory = createFactory({
      config: parsed.config,
      taps: [tap],
      tracker,
      gitHost: new FakeGitHost(),
      runner,
      engine: new FakeEngine(),
      store: new MemoryJobStore(),
    });
    return { factory, api, runner, tracker };
  }

  it("answers Slack's challenge through the factory", async () => {
    const { factory } = factoryWithSlack();
    const response = await factory.handleHttp(
      'slack',
      slackRequest({ type: 'url_verification', challenge: 'c-1' }),
    );
    expect(response.body).toBe('c-1');
  });

  it('turns a mention into a job and replies in its thread, once, even when Slack sends two events', async () => {
    const { factory, api, runner, tracker } = factoryWithSlack();
    const event = messageEvent({
      userId: 'U_OWNER',
      channel: 'C1',
      text: '<@UBOT> add a copy-link button',
    }) as {
      event: Record<string, unknown>;
    };
    await factory.handleHttp('slack', slackRequest(event));
    await factory.handleHttp(
      'slack',
      slackRequest({ ...event, event: { ...event.event, type: 'app_mention' } }),
    );

    expect(tracker.issues.size).toBe(1);
    expect(runner.started).toHaveLength(1);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.body.thread_ts).toBe(event.event.ts);
  });
});
