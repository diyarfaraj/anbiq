# @anbiq/tap-telegram

Telegram for Anbiq, through the Telegram Bot API.

## Set up

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and keep the token.
2. For group chats, add the bot to the group. With privacy mode on (the default), the bot only sees commands such as `/anbiq Add a button`, mentions of it, and replies to its own messages. That is all the factory needs.
3. Find the chat ID: send the bot a message, then open `https://api.telegram.org/bot<token>/getUpdates` and read `message.chat.id`. Group IDs are negative.
4. Point the webhook at the factory, with a secret token of at least 32 random characters:

   ```sh
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url=https://factory.example.com/taps/telegram \
     -d secret_token=$TELEGRAM_SECRET_TOKEN \
     -d 'allowed_updates=["message"]'
   ```

In `anbiq.yml`:

```yaml
taps:
  telegram: { chats: ['-1001234567890'], bot_username: anbiq_bot }
people:
  - name: Dana
    ids: { telegram: '123456789' } # the numeric user ID, never the @username
```

## How it behaves

- **Conversations:** Telegram has no threads. A message that is not a reply starts a new job. To act on an existing job, reply to one of the factory's messages about it, or to the original request.
- **Text:** a leading `/anbiq` or `@bot_username` is removed, so `/anbiq Add a button` is the request "Add a button".
- **Messages** over 4096 characters are split. Suggested replies are shown as text ("Reply to this message with: merge or revise: …").
- **Ignored:** edits, channel posts, messages from bots, and chats that are not listed.

## Security

Telegram authenticates webhooks with the secret token header, compared in constant time. Unlike Slack and Twilio, it does not sign the request body. HTTPS protects the body in transit, so the factory must only be reachable over HTTPS, and the secret token must be long and random. Only the listed chats and the people in `anbiq.yml` can make requests.
