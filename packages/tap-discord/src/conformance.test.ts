import { InMemoryConversationMemory } from '@anbiq/core';
import { describeTapConformance } from '@anbiq/testkit';
import { DiscordTap } from './index.js';
import {
  NOW,
  PUBLIC_KEY,
  command,
  fakeDiscordApi,
  interaction,
  ping,
} from './__fixtures__/discord.js';

describeTapConformance('DiscordTap', () => {
  const memory = new InMemoryConversationMemory();
  const tap = new DiscordTap({
    publicKey: PUBLIC_KEY,
    botToken: 'bot-token',
    channels: ['C1'],
    memory,
    fetch: fakeDiscordApi().fetch,
    now: () => NOW,
  });

  // Follow-up commands happen inside the job's Discord thread. The harness models the
  // suite's thread as one the factory already started.
  const message = (input: { userId: string; channel: string; thread: string; text: string }) => {
    const threadChannel = `thread-${input.thread}`;
    void memory.set(
      `discord:thread:${threadChannel}`,
      JSON.stringify({ tap: 'discord', channel: input.channel, thread: input.thread }),
    );
    return command({ userId: input.userId, channel: threadChannel, text: input.text });
  };

  return {
    tap,
    signed: (input) => interaction(message(input)),
    unsigned: (input) => interaction(message(input), { signed: false }),
    nonMessage: () => interaction(ping()),
  };
});
