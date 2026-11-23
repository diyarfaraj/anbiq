# @anbiq/github

GitHub as Anbiq's tracker and git host: every job is an issue, every change is a pull request, and the factory authenticates as a GitHub App with short-lived tokens. There are no personal access tokens.

## Create the GitHub App

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**:

- **Webhook:** off for now. The factory reads what it needs on demand.
- **Repository permissions:**

  | Permission      | Access         | Why                                                       |
  | --------------- | -------------- | --------------------------------------------------------- |
  | Issues          | Read and write | Create jobs, post updates, move stage labels, claim jobs  |
  | Pull requests   | Read and write | Open pull requests and read their head commit             |
  | Contents        | Read and write | Merge pull requests (GitHub requires write to merge)      |
  | Checks          | Read           | Decide whether a pull request's checks passed             |
  | Commit statuses | Read           | The same, for CI systems that report statuses, not checks |
  | Metadata        | Read           | Required by GitHub for every app                          |

- Install it on the repository the factory works on, and note the **App ID**, the **installation ID** (in the installation's URL) and a **private key**.

These permissions belong to the factory service, which merges only after a person says `merge`. Agent runs get their own, narrower credentials from the runner and never see this key.

## Protect the base branch

Require pull requests and your CI checks on the base branch. The factory never pushes to it directly, and branch protection makes sure nobody else can either.

## Usage

```ts
import { GitHubAppAuth, GitHubGitHost, GitHubTracker } from '@anbiq/github';

const auth = new GitHubAppAuth({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  installationId: process.env.GITHUB_APP_INSTALLATION_ID!,
});
const repo = { owner: 'acme', repo: 'web', auth };

const tracker = new GitHubTracker(repo);
const gitHost = new GitHubGitHost({ ...repo, baseBranch: 'main' });
```

## How it behaves

- **Jobs** are issues labelled `anbiq`. The stage is an `anbiq:stage:<stage>` label that moves as the job does, and any other labels people add are kept.
- **Claims:** GitHub has no lock, so a claim is a marked comment. Comment IDs are strictly ordered, so when two runs claim at the same moment both see the same earliest claim and only its owner goes ahead. Released claims stay as comments, which doubles as an audit trail of every run on the job.
- **Checks** count as passed only when at least one check run or commit status exists for the head commit, none is still running, and none failed. A repository with no CI never counts as passing, so the factory cannot merge untested work.
- **Merges** are squash merges pinned to the reviewed commit (GitHub's `sha` parameter). If anything was pushed after the review, GitHub refuses, and the factory asks for a fresh review.
- **Installation tokens** are cached and renewed five minutes before they expire.
