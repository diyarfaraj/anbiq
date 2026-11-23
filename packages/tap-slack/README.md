# @anbiq/tap-slack

The Slack tap for Anbiq. People post a request in a factory channel, and every reply about that job (status, questions, the pull request, approvals) arrives in the same thread.

## Set up the Slack app

1. Create an app at <https://api.slack.com/apps> → **Create New App** → **From a manifest**, and paste:

   ```yaml
   display_information:
     name: Anbiq
   features:
     bot_user:
       display_name: anbiq
       always_online: true
   oauth_config:
     scopes:
       bot:
         - chat:write # reply in threads
         - channels:history # read messages in public factory channels
         - groups:history # read messages in private factory channels
         - app_mentions:read # notice @anbiq mentions
   settings:
     event_subscriptions:
       request_url: https://YOUR-FACTORY-HOST/taps/slack
       bot_events:
         - message.channels
         - message.groups
         - app_mention
   ```

2. Install the app to your workspace and copy the **Bot User OAuth Token** (`xoxb-…`) and the **Signing Secret**. Keep both in your secret store, never in the repository.
3. Create a dedicated channel, for example `#factory`, and invite the bot (`/invite @anbiq`). Every top-level message in a factory channel is treated as a request, so don't use a busy general channel.
4. Copy the channel ID (channel details → bottom of the About tab) into `anbiq.yml`:

   ```yaml
   taps:
     slack:
       channels: [C0123456789]
   people:
     - name: Owner
       ids:
         slack: U0123456789 # the member ID from the person's Slack profile, never a display name
       roles: [requester, approver]
   ```

## What the tap does

- **Verifies** Slack's `X-Slack-Signature` on every request and rejects anything older than five minutes, so a captured request cannot be replayed.
- **Answers** Slack's URL verification challenge when you save the Request URL.
- **Listens** only in the configured channels. It ignores bot messages (including its own replies), edits and join notices, and strips `@anbiq` mentions from the text.
- **Counts each message once.** Slack retries deliveries and sends both a `message` and an `app_mention` event for one mention; both carry the same channel and timestamp, which the factory uses to drop the duplicate.
- **Replies** in the thread with Block Kit, escaping Slack markup and splitting long text into sections Slack accepts. Suggested replies are shown as text (`Reply merge or revise:`) for now, as the tap does not handle Slack button clicks yet.

## Respond within three seconds

Slack retries an event if your endpoint does not answer within three seconds. Acknowledge the HTTP request first and do the work afterwards. The duplicate check keeps a retry from creating a second job, but answering quickly avoids the retries in the first place.

## Usage

```ts
import { SlackTap } from '@anbiq/tap-slack';

const slack = new SlackTap({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  botToken: process.env.SLACK_BOT_TOKEN!,
  channels: config.taps.slack.channels,
});
```
