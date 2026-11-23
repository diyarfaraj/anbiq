import { describe, expect, it } from 'vitest';
import { InMemoryConversationMemory } from '@anbiq/core';
import { COMMAND_DEFINITION, DiscordTap, registerCommand } from './index.js';
import {
  NOW,
  PUBLIC_KEY,
  command,
  fakeDiscordApi,
  interaction,
  ping,
} from './__fixtures__/discord.js';

function setup(failWith?: { status: number; message: string }) {
  const api = fakeDiscordApi(failWith);
  const tap = new DiscordTap({
    publicKey: PUBLIC_KEY,
    botToken: 'bot-token',
    channels: ['C1'],
    memory: new InMemoryConversationMemory(),
    fetch: api.fetch,
    now: () => NOW,
  });
  return { tap, api };
}

describe('DiscordTap', () => {
  it('answers the signed PING Discord sends when the endpoint is saved', async () => {
    const { tap } = setup();
    const request = interaction(ping());
    expect(await tap.verify(request)).toBe(true);
    expect(await tap.handshake(request)).toEqual({
      status: 200,
      body: '{"type":1}',
      contentType: 'application/json',
    });
    expect(
      await tap.handshake(interaction(command({ userId: '1', channel: 'C1', text: 'x' }))),
    ).toBeNull();
  });

  it('refuses old signatures and malformed keys', async () => {
    const { tap } = setup();
    const old = interaction(ping(), { at: new Date(NOW.getTime() - 10 * 60 * 1000) });
    expect(await tap.verify(old)).toBe(false);
    expect(() => new DiscordTap({ publicKey: 'abc', botToken: 't', channels: [] })).toThrow(
      /64 hex/,
    );
  });

  it('acknowledges every command at once, without pinging anyone', () => {
    const { tap } = setup();
    expect(JSON.parse(tap.acknowledgement.body!)).toEqual({
      type: 4,
      data: { content: 'Received.', allowed_mentions: { parse: [] } },
    });
  });

  it('only takes /anbiq from people, in configured channels', async () => {
    const { tap } = setup();
    expect(
      await tap.parse(interaction(command({ userId: '1', channel: 'C9', text: 'x' }))),
    ).toBeNull();
    expect(
      await tap.parse(interaction(command({ userId: '1', channel: 'C1', text: 'x', bot: true }))),
    ).toBeNull();
    expect(
      await tap.parse(
        interaction(command({ userId: '1', channel: 'C1', text: 'x', name: 'other' })),
      ),
    ).toBeNull();
    expect(
      await tap.parse(interaction(command({ userId: '1', channel: 'C1', text: '   ' }))),
    ).toBeNull();
  });

  it('starts a thread for a new job, then keeps the job together inside it', async () => {
    const { tap, api } = setup();
    const request = await tap.parse(
      interaction(command({ userId: '1', channel: 'C1', text: 'Add a button', id: '55' })),
    );
    expect(request?.thread).toEqual({ tap: 'discord', channel: 'C1', thread: '55' });

    await tap.send(request!.thread, { title: 'Spec ready', body: 'Acceptance criteria…' });
    expect(api.calls.map((call) => call.path)).toEqual([
      '/channels/C1/messages',
      '/channels/C1/messages/7001/threads',
      '/channels/7002/messages',
    ]);
    expect(api.calls[1]?.body).toMatchObject({ name: 'Spec ready' });

    await tap.send(request!.thread, { title: 'Ready for review' });
    expect(api.calls.at(-1)?.path).toBe('/channels/7002/messages');

    const merge = await tap.parse(
      interaction(command({ userId: '1', channel: '7002', text: 'merge' })),
    );
    expect(merge?.thread).toEqual(request?.thread);
  });

  it('never lets text from a request or a crew ping @everyone', async () => {
    const { tap, api } = setup();
    await tap.send({ tap: 'discord', channel: 'C1', thread: '1' }, { title: '@everyone look' });
    const posts = api.calls.filter((call) => call.path.endsWith('/messages'));
    expect(
      posts.every((call) => JSON.stringify(call.body.allowed_mentions) === '{"parse":[]}'),
    ).toBe(true);
  });

  it('reports a failed send', async () => {
    const { tap } = setup({ status: 403, message: 'Missing Permissions' });
    await expect(
      tap.send({ tap: 'discord', channel: 'C1', thread: '1' }, { title: 'x' }),
    ).rejects.toThrow(/Missing Permissions/);
  });

  it('registers the /anbiq command for one server', async () => {
    const api = fakeDiscordApi();
    await registerCommand({ applicationId: 'app', botToken: 't', guildId: 'g', fetch: api.fetch });
    expect(api.calls[0]).toEqual({
      path: '/applications/app/guilds/g/commands',
      body: JSON.parse(JSON.stringify(COMMAND_DEFINITION)),
    });
  });
});
