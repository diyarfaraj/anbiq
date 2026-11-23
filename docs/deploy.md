# Deploying Anbiq

The server is one small container. It receives chat webhooks, dispatches crew runs to GitHub Actions, takes their signed results back, and keeps its state in one SQLite file.

## 1. Prepare the repository the factory works on

- Create the GitHub App and install it on the repository: [`@anbiq/github`](../packages/github/README.md). Add **Actions: read and write** to the permissions listed there, so the factory can dispatch and cancel runs.
- Add the crew workflow, its secrets and the callback variable: [`@anbiq/runner-github-actions`](../packages/runner-github-actions/README.md).
- Protect the base branch: pull requests only, with your CI checks required.

## 2. Write `anbiq.yml`

```yaml
project: acme-web
taps:
  slack: { channels: [C0123456789] }
  whatsapp-twilio: { from: '+15550100' }
people:
  - name: Dana
    ids: { slack: U0123456789, whatsapp-twilio: '+46700000000' }
    roles: [requester, approver]
tracker: github-issues
git_host: github
runner: github-actions
engine: { id: claude-code, max_turns: 60, timeout_minutes: 60 }
checks: { verify: ['pnpm test', 'pnpm lint'] }
budgets: { usd_per_day: 25, jobs_per_day: 10, concurrent_jobs: 1 }
```

The full schema is in [architecture.md](architecture.md). The server refuses to start if the file is invalid, and lists every problem at once.

## 3. Set the environment

| Variable                     | Required            | Meaning                                                                |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------- |
| `ANBIQ_PUBLIC_URL`           | yes                 | The server's public https URL, without a trailing path                 |
| `ANBIQ_CALLBACK_SECRET`      | yes                 | At least 32 random characters; the same value as the repository secret |
| `GITHUB_REPOSITORY`          | yes                 | `owner/repo` the factory works on                                      |
| `GITHUB_APP_ID`              | yes                 | The GitHub App's ID                                                    |
| `GITHUB_APP_INSTALLATION_ID` | yes                 | The installation ID on that repository                                 |
| `GITHUB_APP_PRIVATE_KEY`     | yes                 | The app's private key (PEM; `\n` escapes are accepted)                 |
| `SLACK_SIGNING_SECRET`       | with Slack          | From the Slack app's Basic Information page                            |
| `SLACK_BOT_TOKEN`            | with Slack          | The bot token (`xoxb-…`) with `chat:write`                             |
| `TWILIO_ACCOUNT_SID`         | with WhatsApp       | Twilio account SID                                                     |
| `TWILIO_AUTH_TOKEN`          | with WhatsApp       | Twilio auth token                                                      |
| `ANBIQ_BASE_BRANCH`          | no, `main`          | The branch pull requests target and the workflow is read from          |
| `ANBIQ_WORKFLOW`             | no, `anbiq-run.yml` | The crew workflow file name                                            |
| `PORT`                       | no, `8080`          | Port to listen on                                                      |
| `ANBIQ_CONFIG`               | no                  | Path to `anbiq.yml` (`/config/anbiq.yml` in the image)                 |
| `ANBIQ_DATA`                 | no                  | Path to the SQLite file (`/data/anbiq.db` in the image)                |

Keep secrets in your platform's secret store, not in `anbiq.yml`.

## 4. Run it

```sh
docker build -t anbiq .
docker run -d --name anbiq -p 8080:8080 \
  -v "$PWD/anbiq.yml:/config/anbiq.yml:ro" \
  -v anbiq-data:/data \
  --env-file anbiq.env \
  anbiq
```

Put it behind a TLS-terminating proxy (Caddy, a cloud load balancer, or a tunnel) at `ANBIQ_PUBLIC_URL`. Run one instance: SQLite and the in-process queue assume a single server. Back up the `/data` volume.

## 5. Point the chat apps at it

| Endpoint                     | Who calls it                                         |
| ---------------------------- | ---------------------------------------------------- |
| `POST /taps/slack`           | Slack Events API request URL                         |
| `POST /taps/whatsapp-twilio` | Twilio WhatsApp sender, "a message comes in" webhook |
| `POST /runs/:runId`          | The crew workflow, with a signed result              |
| `GET /healthz`               | Your load balancer or uptime check                   |

Every webhook is verified with the platform's signature before it is read. Messages are acknowledged at once and handled after, one at a time, so platforms never retry because of a slow reply.

## Logs

One JSON object per line on stdout: requests (method, path, status, duration), run results (run, job, stage, outcome) and errors. Message text, headers and secrets are never logged.
