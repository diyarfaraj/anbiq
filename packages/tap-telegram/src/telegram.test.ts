import { describe, expect, it } from 'vitest';
import { InMemoryConversationMemory } from '@anbiq/core';
import { TelegramTap } from './index.js';
import { NOW, SECRET, fakeBotApi, textMessage, update } from './__fixtures__/telegram.js';

const CHAT = '-1001';

function setup(reply?: { ok: boolean; description?: string }) {
  const api = fakeBotApi(reply);
  const tap = new TelegramTap({
    botToken: '123:abc',
    secretToken: SECRET,
    chats: [CHAT],
    botUsername: 'anbiq_bot',
    memory: new InMemoryConversationMemory(),
    fetch: api.fetch,
    now: () => NOW,
  });
  return { tap, api };
}

describe('TelegramTap', () => {
  it('rejects a wrong secret token', async () => {
    const { tap } = setup();
    expect(
      await tap.verify(
        update(textMessage({ userId: '1', chat: CHAT, text: 'x' }), { secret: 'wrong' }),
      ),
    ).toBe(false);
  });

  it('ignores chats that are not configured, bots, and messages without text', async () => {
    const { tap } = setup();
    expect(
      await tap.parse(update(textMessage({ userId: '1', chat: '-999', text: 'hi' }))),
    ).toBeNull();
    expect(
      await tap.parse(update(textMessage({ userId: '1', chat: CHAT, text: 'hi', isBot: true }))),
    ).toBeNull();
    expect(
      await tap.parse(update({ message_id: 1, from: { id: 1 }, chat: { id: Number(CHAT) } })),
    ).toBeNull();
    expect(await tap.parse({ ...update(null), body: 'not json' })).toBeNull();
  });

  it('removes the command or mention people use in group chats', async () => {
    const { tap } = setup();
    const command = await tap.parse(
      update(textMessage({ userId: '1', chat: CHAT, text: '/anbiq@anbiq_bot Add a button' })),
    );
    const mention = await tap.parse(
      update(textMessage({ userId: '1', chat: CHAT, text: '@anbiq_bot, add a button' })),
    );
    expect(command?.text).toBe('Add a button');
    expect(mention?.text).toBe('add a button');
    expect(
      await tap.parse(update(textMessage({ userId: '1', chat: CHAT, text: '/anbiq' }))),
    ).toBeNull();
  });

  it('threads a conversation through replies to the factory and to the original request', async () => {
    const { tap, api } = setup();
    const request = await tap.parse(
      update(textMessage({ userId: '1', chat: CHAT, text: 'Add a button', messageId: 10 })),
    );
    expect(request?.thread).toEqual({ tap: 'telegram', channel: CHAT, thread: '10' });

    await tap.send(request!.thread, { title: 'Ready for review' });
    const sentId = 5001;
    expect(api.calls[0]?.body).toMatchObject({
      chat_id: CHAT,
      reply_parameters: { message_id: 10 },
    });

    const merge = await tap.parse(
      update(textMessage({ userId: '1', chat: CHAT, text: 'merge', replyTo: sentId })),
    );
    const status = await tap.parse(
      update(textMessage({ userId: '1', chat: CHAT, text: 'status', replyTo: 10 })),
    );
    expect(merge?.thread.thread).toBe('10');
    expect(status?.thread.thread).toBe('10');

    const unrelated = await tap.parse(
      update(textMessage({ userId: '1', chat: CHAT, text: 'New idea', messageId: 20 })),
    );
    expect(unrelated?.thread.thread).toBe('20');
  });

  it('splits long messages at the Telegram limit and shows suggested replies as text', async () => {
    const { tap, api } = setup();
    await tap.send(
      { tap: 'telegram', channel: CHAT, thread: '10' },
      { title: 'Done', body: 'x'.repeat(5000), actions: [{ label: 'Merge', command: 'merge' }] },
    );
    expect(api.calls).toHaveLength(2);
    expect(String(api.calls.at(-1)?.body.text)).toContain('Reply to this message with: merge');
  });

  it('reports a failed send', async () => {
    const { tap } = setup({ ok: false, description: 'Forbidden: bot was blocked by the user' });
    await expect(
      tap.send({ tap: 'telegram', channel: CHAT, thread: '1' }, { title: 'x' }),
    ).rejects.toThrow(/blocked/);
  });
});
