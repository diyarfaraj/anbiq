import { describeTapConformance } from '@anbiq/testkit';
import { SlackTap } from './index.js';
import { NOW, SECRET, fakeSlackApi, messageEvent, slackRequest } from './__fixtures__/slack.js';

describeTapConformance('SlackTap', () => {
  const tap = new SlackTap({
    signingSecret: SECRET,
    botToken: 'xoxb-test',
    channels: ['C1'],
    fetch: fakeSlackApi().fetch,
    now: () => NOW,
  });
  return {
    tap,
    signed: (input) => slackRequest(messageEvent(input)),
    unsigned: (input) => slackRequest(messageEvent(input), { secret: null }),
    nonMessage: () => slackRequest({ type: 'url_verification', challenge: 'abc' }),
  };
});
