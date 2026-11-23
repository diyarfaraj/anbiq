# @anbiq/tap-whatsapp-twilio

The WhatsApp tap for Anbiq, through Twilio. People message the factory's WhatsApp number to start work, and reply to the factory's messages to follow up.

## How conversations work

WhatsApp has no threads, so the tap uses WhatsApp's own reply feature:

- **A new message** (not a reply) starts a new request.
- **A reply to one of the factory's messages** (swipe right on it, or long-press → Reply) belongs to that job. Send `status`, `merge`, `revise: …`, `deploy production` or `cancel` this way.
- A command sent as a plain message, not as a reply, has no job to act on, and the factory says so.

## Set up Twilio

1. **Development:** use the [Twilio Sandbox for WhatsApp](https://www.twilio.com/docs/whatsapp/sandbox). Each person joins the sandbox once from their phone. No business verification is needed.
2. **Production:** register a WhatsApp sender in Twilio. This requires Meta business verification and an approved display name, and can take days.
3. Set the sender's **"A message comes in"** webhook to `https://YOUR-FACTORY-HOST/taps/whatsapp-twilio` (HTTP POST).
4. Give the tap the exact same URL as `webhookUrl`. Twilio signs the full URL it calls, so a proxy that changes the scheme, host, port or path will make every request fail verification.
5. Keep the Account SID and Auth Token in your secret store.

```yaml
# anbiq.yml
taps:
  whatsapp-twilio:
    number: '+15550100'
people:
  - name: Owner
    ids:
      whatsapp-twilio: '+15550123' # the person's number in E.164 form
    roles: [requester, approver]
```

## The 24-hour window

WhatsApp only allows free-form messages within 24 hours of the person's last message. Jobs can take longer than that, so:

- **Create an approved WhatsApp template** in Twilio's Content Template Builder, for example: `Update from your factory: {{1}}. Reply to this message to continue.`
- **Pass its Content SID** as `templateContentSid`. Outside the window, the tap sends the template with the message title as `{{1}}`. The person's reply reopens the window, and the full details follow.

Without a template, messages outside the window are accepted by Twilio's API but are not delivered.

## Conversation memory

The tap remembers which job each sent message belongs to and when each person last wrote. The default `InMemoryConversationMemory` is lost on restart and is not shared between instances. Pass a persistent `ConversationMemory` (any key-value store) in production.

## What the tap does

- **Verifies** `X-Twilio-Signature` (HMAC-SHA1 over the configured URL and the sorted form fields) with a constant-time comparison.
- **Uses the sender's phone number as the identity,** matched against `anbiq.yml`.
- **Ignores** delivery status callbacks and media-only messages.
- **Splits** long messages into parts within Twilio's 1,600-character limit, and maps every part back to the job so a reply to any of them works.
- **Answers** each webhook with an empty TwiML response, so Twilio sends nothing automatically.

## Usage

```ts
import { WhatsAppTap } from '@anbiq/tap-whatsapp-twilio';

const whatsapp = new WhatsAppTap({
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  from: '+15550100',
  webhookUrl: 'https://factory.example.com/taps/whatsapp-twilio',
  templateContentSid: process.env.TWILIO_WHATSAPP_TEMPLATE_SID,
  memory: myPersistentMemory,
});
```
