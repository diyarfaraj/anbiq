# @anbiq/server

The [Anbiq](https://github.com/diyarfaraj/anbiq) server. It receives chat webhooks, dispatches crew runs to GitHub Actions, takes their signed results back, keeps state in one SQLite file, and serves the live board.

```sh
npm install --global @anbiq/server
ANBIQ_CONFIG=anbiq.yml anbiq-server
```

Or use the container image built from the repository's `Dockerfile`.

| Route               | What it is                                                                |
| ------------------- | ------------------------------------------------------------------------- |
| `POST /taps/:tap`   | Chat webhooks: Slack, WhatsApp, Telegram, Discord, Microsoft Teams        |
| `POST /runs/:runId` | Signed results from crew runs                                             |
| `GET /board`        | The live board, when `ANBIQ_BOARD_PASSWORD` is set                        |
| `POST /events`      | Signed events from factories elsewhere, when `ANBIQ_EVENTS_SECRET` is set |
| `GET /healthz`      | Health check                                                              |

The server refuses to start while any setting is missing or invalid, and lists every problem at once. Configuration, every environment variable and the webhook setup for each chat app are in the [deploy guide](https://github.com/diyarfaraj/anbiq/blob/main/docs/deploy.md).

Requires Node.js 22 or later (it uses the built-in `node:sqlite`).
