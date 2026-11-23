# @anbiq/tap-discord

Discord for Anbiq, through a signed `/anbiq` slash command and the Discord REST API.

Discord sends ordinary chat messages to bots only over a persistent gateway connection, which a webhook server cannot hold. Slash commands come to an HTTPS endpoint, signed, so that is what this tap uses:

```
/anbiq request: Add a copy-link button to the booking page
```

The factory answers by starting a Discord thread for the job. Inside that thread, `/anbiq request: merge`, `/anbiq request: revise: make it larger`, `status`, `cancel` and `deploy <env>` act on that job.

## Set up

1. In the [Developer Portal](https://discord.com/developers/applications), create an application. From **General Information**, copy the **Application ID** and **Public Key**.
2. Under **Bot**, reset and copy the token.
3. Under **OAuth2 → URL Generator**, pick the `bot` and `applications.commands` scopes and these permissions: View Channels, Send Messages, Create Public Threads, Send Messages in Threads. Open the URL to add the bot to your server.
4. Register the command once:

   ```ts
   import { registerCommand } from '@anbiq/tap-discord';
   await registerCommand({ applicationId, botToken, guildId }); // guildId: instant; omit for global
   ```

5. Set **Interactions Endpoint URL** to `https://factory.example.com/taps/discord`. Discord checks it with a signed PING when you save, so the factory must be running.

In `anbiq.yml`:

```yaml
taps:
  discord: { channels: ['123456789012345678'] }
people:
  - name: Dana
    ids: { discord: '234567890123456789' } # the numeric user ID (Developer Mode → Copy User ID)
```

## How it behaves

- **Commands** are accepted only in the listed channels and in the job threads the factory started there. Commands from bots are ignored.
- **Every command** gets an immediate "Received." reply, because Discord requires an answer within three seconds. The factory's real reply follows in the job's thread.
- **Messages** over 2000 characters are split, and suggested replies are shown as text.
- **Mentions are off** on everything the factory posts. Text from a request or a crew cannot ping `@everyone`, roles or people.

## Security

Every request is verified with the application's Ed25519 public key over the timestamp and the raw body. Requests older than five minutes are refused. The bot token is only used for posting and is never sent anywhere else.
