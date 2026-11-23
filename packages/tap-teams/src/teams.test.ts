import { describe, expect, it } from 'vitest';
import { TeamsTap } from './index.js';
import {
  APP_ID,
  CHANNEL,
  NOW,
  SERVICE_URL,
  TENANT,
  activityRequest,
  botToken,
  channelMessage,
  fakeMicrosoft,
} from './__fixtures__/teams.js';

function setup(options: { failSend?: boolean } = {}) {
  const microsoft = fakeMicrosoft(options);
  const tap = new TeamsTap({
    appId: APP_ID,
    appPassword: 'secret',
    tenantId: TENANT,
    channels: [CHANNEL],
    fetch: microsoft.fetch,
    now: () => NOW,
  });
  return { tap, microsoft };
}

const message = (extra: Partial<Parameters<typeof channelMessage>[0]> = {}) =>
  channelMessage({ userId: 'aad-1', root: '111', text: '<at>Anbiq</at> Add a button', ...extra });

describe('TeamsTap verification', () => {
  it('accepts a token Microsoft signed for this bot and this service URL', async () => {
    const { tap } = setup();
    expect(await tap.verify(activityRequest(message()))).toBe(true);
  });

  it('refuses tokens for another bot, another issuer, another service URL, or expired ones', async () => {
    const { tap } = setup();
    const expired = Math.floor(NOW.getTime() / 1000) - 3600;
    for (const claims of [
      { aud: 'another-bot' },
      { iss: 'https://evil.test' },
      { serviceurl: 'https://evil.test/' },
      { exp: expired },
    ]) {
      expect(await tap.verify(activityRequest(message(), { token: botToken(claims) }))).toBe(false);
    }
  });

  it('refuses a token whose signature does not match', async () => {
    const { tap } = setup();
    const [header, , signature] = botToken().split('.');
    const forgedClaims = Buffer.from(
      JSON.stringify({
        iss: 'https://api.botframework.com',
        aud: APP_ID,
        exp: 9e9,
        serviceurl: SERVICE_URL,
      }),
    ).toString('base64url');
    expect(
      await tap.verify(
        activityRequest(message(), { token: `${header}.${forgedClaims}.${signature}` }),
      ),
    ).toBe(false);
  });

  it("caches Microsoft's signing keys", async () => {
    const { tap, microsoft } = setup();
    await tap.verify(activityRequest(message()));
    await tap.verify(activityRequest(message()));
    expect(microsoft.keyFetches()).toBe(1);
  });
});

describe('TeamsTap messages', () => {
  it('removes the bot mention and HTML, and threads by the channel post', async () => {
    const { tap } = setup();
    const parsed = await tap.parse(
      activityRequest(
        message({ text: '<p><at>Anbiq</at>&nbsp;Add a <b>copy-link</b> button</p>' }),
      ),
    );
    expect(parsed).toMatchObject({
      userId: 'aad-1',
      text: 'Add a copy-link button',
      thread: { tap: 'teams', channel: CHANNEL, thread: '111' },
    });
  });

  it('ignores other tenants, other channels, chats and empty mentions', async () => {
    const { tap } = setup();
    expect(await tap.parse(activityRequest(message({ tenant: 'other' })))).toBeNull();
    expect(
      await tap.parse(activityRequest(message({ channel: '19:other@thread.tacv2' }))),
    ).toBeNull();
    expect(await tap.parse(activityRequest(message({ text: '<at>Anbiq</at>' })))).toBeNull();
    const personal = { ...message(), conversation: { id: 'a:1', conversationType: 'personal' } };
    expect(await tap.parse(activityRequest(personal))).toBeNull();
  });

  it('replies in the thread through the Bot Connector, reusing its access token', async () => {
    const { tap, microsoft } = setup();
    const parsed = await tap.parse(activityRequest(message()));
    await tap.send(parsed!.thread, {
      title: 'Ready for review',
      actions: [{ label: 'Merge', command: 'merge' }],
    });
    await tap.send(parsed!.thread, { title: 'Merged' });

    const reply = microsoft.replies[0]!;
    expect(reply.url).toBe(
      `${SERVICE_URL}v3/conversations/${encodeURIComponent(`${CHANNEL};messageid=111`)}/activities`,
    );
    expect(reply.auth).toBe('Bearer bot-token-1');
    expect(reply.body).toMatchObject({ type: 'message', textFormat: 'plain' });
    expect(String(reply.body.text)).toContain('Reply in this thread with: merge');
    expect(microsoft.tokenRequests()).toBe(1);
  });

  it('refuses to send to a conversation it has never heard from', async () => {
    const { tap } = setup();
    await expect(
      tap.send({ tap: 'teams', channel: 'unknown', thread: '1' }, { title: 'x' }),
    ).rejects.toThrow(/service URL/);
  });

  it('reports a failed send', async () => {
    const { tap } = setup({ failSend: true });
    const parsed = await tap.parse(activityRequest(message()));
    await expect(tap.send(parsed!.thread, { title: 'x' })).rejects.toThrow(/403/);
  });
});
