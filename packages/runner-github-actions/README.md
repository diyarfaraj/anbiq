# @anbiq/runner-github-actions

Runs each Anbiq crew as a GitHub Actions workflow in the repository the factory works on, and reports the result back to the factory with a signed callback.

## Set up the repository

1. Copy [`templates/anbiq-run.yml`](templates/anbiq-run.yml) to `.github/workflows/anbiq-run.yml` on the base branch.
2. Add the secrets and variable under Settings → Secrets and variables → Actions:
   - secret `ANTHROPIC_API_KEY`: the key the crews run on;
   - secret `ANBIQ_CALLBACK_SECRET`: a long random string, the same one the factory is given;
   - variable `ANBIQ_CALLBACK_URL`: the factory's public base URL. Results are posted to `<url>/runs/<run id>`.
3. Give the factory's GitHub App the **Actions: read and write** permission, so it can dispatch and cancel runs.

## How a run works

The workflow has two jobs, so the agent never holds write access or the factory's secrets:

- **crew** checks out the job branch with a read-only token and no stored credentials, runs Claude Code with the tools the engine allowed, and uploads the result and a git bundle of any new commits.
- **publish** runs no agent. It pushes the bundle to the job branch (only branches named `anbiq/…`), then signs the result with HMAC-SHA256 over `<timestamp>.<body>` and posts it to the factory.

Inputs and agent output reach shell steps only through environment variables, never by interpolation into scripts. Runs of the same job are serialised with a concurrency group.

## Usage

```ts
import { GitHubAppAuth } from '@anbiq/github';
import { GitHubActionsRunner, parseCallback, verifyCallback } from '@anbiq/runner-github-actions';

const runner = new GitHubActionsRunner({
  owner: 'acme',
  repo: 'web',
  auth,
  workflow: 'anbiq-run.yml',
  ref: 'main',
});

// In the factory's HTTP server, for POST /runs/:runId:
if (
  !verifyCallback({
    secret,
    body,
    timestamp: headers['x-anbiq-timestamp'],
    signature: headers['x-anbiq-signature'],
  })
) {
  return { status: 401 };
}
const parsed = parseCallback(body, runId);
if (parsed.ok) await factory.handleRunResult(parsed.result);
```

Callbacks older than ten minutes are refused, and a callback is validated like any untrusted input: known stages and outcomes only, commit SHAs must be full SHAs, and summaries are capped at 8000 characters.

Cancelling a run finds the workflow run by its run name (`anbiq <run id>`) and cancels it.
