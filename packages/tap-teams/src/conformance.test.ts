import { describeTapConformance } from '@anbiq/testkit';
import { TeamsTap } from './index.js';
import {
  APP_ID,
  NOW,
  TENANT,
  activityRequest,
  channelMessage,
  fakeMicrosoft,
} from './__fixtures__/teams.js';

describeTapConformance('TeamsTap', () => {
  const tap = new TeamsTap({
    appId: APP_ID,
    appPassword: 'secret',
    tenantId: TENANT,
    channels: ['C1'],
    fetch: fakeMicrosoft().fetch,
    now: () => NOW,
  });
  const roots = new Map<string, string>();
  const message = (input: { userId: string; channel: string; thread: string; text: string }) => {
    const root = roots.get(input.thread) ?? String(1000 + roots.size);
    roots.set(input.thread, root);
    return channelMessage({ userId: input.userId, channel: input.channel, root, text: input.text });
  };
  return {
    tap,
    signed: (input) => activityRequest(message(input)),
    unsigned: (input) => activityRequest(message(input), { token: null }),
    nonMessage: () => activityRequest({ type: 'conversationUpdate', serviceUrl: 'https://x.test' }),
    // The Bot Framework token authenticates the sender and the service URL, not the body.
    signsBody: false,
  };
});
