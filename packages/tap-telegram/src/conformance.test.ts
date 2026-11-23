import { InMemoryConversationMemory } from '@anbiq/core';
import { describeTapConformance } from '@anbiq/testkit';
import { TelegramTap } from './index.js';
import { NOW, SECRET, fakeBotApi, textMessage, update } from './__fixtures__/telegram.js';

const CHAT = '-1001';

describeTapConformance('TelegramTap', () => {
  const memory = new InMemoryConversationMemory();
  const tap = new TelegramTap({
    botToken: '123:abc',
    secretToken: SECRET,
    chats: [CHAT],
    memory,
    fetch: fakeBotApi().fetch,
    now: () => NOW,
  });

  // Telegram has no threads: a conversation continues when someone replies to one of the
  // factory's messages. The harness models the suite's thread as such a message.
  const roots = new Map<string, number>();
  const message = (input: { userId: string; thread: string; text: string }) => {
    const root = roots.get(input.thread) ?? 900 + roots.size;
    roots.set(input.thread, root);
    void memory.set(`telegram:${CHAT}:${root}`, String(root));
    return textMessage({ userId: input.userId, chat: CHAT, text: input.text, replyTo: root });
  };

  return {
    tap,
    signed: (input) => update(message(input)),
    unsigned: (input) => update(message(input), { secret: null }),
    nonMessage: () => update(null),
    signsBody: false,
  };
});
