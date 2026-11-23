import { describeTapConformance } from '@anbiq/testkit';
import { InMemoryConversationMemory, WhatsAppTap } from './index.js';
import {
  AUTH_TOKEN,
  NOW,
  WEBHOOK_URL,
  fakeTwilioApi,
  inbound,
  twilioRequest,
} from './__fixtures__/twilio.js';

describeTapConformance('WhatsAppTap', () => {
  const memory = new InMemoryConversationMemory();
  const tap = new WhatsAppTap({
    accountSid: 'AC123',
    authToken: AUTH_TOKEN,
    from: '+15550100',
    webhookUrl: WEBHOOK_URL,
    memory,
    fetch: fakeTwilioApi().fetch,
    now: () => NOW,
  });

  // WhatsApp has no threads: a conversation continues when someone replies to one of the
  // factory's messages. The harness models the suite's thread as such a message.
  const message = (input: { userId: string; thread: string; text: string }) => {
    void memory.set(`sent:${input.thread}`, input.thread);
    return inbound({ from: input.userId, text: input.text, repliedTo: input.thread });
  };

  return {
    tap,
    signed: (input) => twilioRequest(message(input)),
    unsigned: (input) => twilioRequest(message(input), { token: null }),
    nonMessage: () =>
      twilioRequest({ MessageSid: 'SM1', MessageStatus: 'delivered', From: 'whatsapp:+15550100' }),
  };
});
