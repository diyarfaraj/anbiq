# @anbiq/tap-teams

Microsoft Teams for Anbiq, through the Bot Framework.

It works in **team channels**, where every post is a thread. Mention the bot in a new post to make a request: `@Anbiq Add a copy-link button`. Then reply in that post's thread, mentioning the bot again, to act on the job: `@Anbiq merge`, `@Anbiq revise: make it larger`, `status`, `cancel` or `deploy <env>`. Personal and group chats are not supported yet.

## Set up

1. In the [Azure portal](https://portal.azure.com), create an **Azure Bot** as a single-tenant app. Copy the **Microsoft App ID** and **tenant ID**, then create a **client secret** for the app registration.
2. In the bot's **Configuration**, set the messaging endpoint to `https://factory.example.com/taps/teams`. Under **Channels**, add Microsoft Teams.
3. Make a Teams app package (`manifest.json` plus two icons) whose `bots` entry uses the App ID with `"scopes": ["team"]`. Upload it to your team through the Developer Portal for Teams or Teams admin.
4. Find the channel ID: in Teams, use **Get link to channel** on the channel. The ID is the `19:…@thread.tacv2` part, URL-decoded.

In `anbiq.yml`:

```yaml
taps:
  teams: { channels: ['19:abc123@thread.tacv2'] }
people:
  - name: Dana
    ids: { teams: 'aad-object-id-of-dana' } # the Microsoft Entra object ID, never a display name
```

The server reads `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD` and `TEAMS_TENANT_ID`.

## How it behaves

- **Requests:** the bot's mention and Teams' HTML formatting are removed from the text.
- **Replies** go into the same post's thread, as plain text. Suggested replies are shown as text.
- **Ignored:** activities from other tenants, from channels that are not listed, from chats, and anything that is not a message.

## Security

Every request carries a token signed by the Bot Framework. The tap checks:

- the token's signature, against Microsoft's published keys, which are cached for a day and endorsed for Teams;
- the issuer;
- the audience, which must be this bot;
- the token's lifetime;
- that the token was issued for the service URL in the activity.

The token authenticates the sender but does not sign the body; HTTPS protects the body. The factory replies only to service URLs it received in a verified activity, using a client-credentials token for this bot's tenant.
