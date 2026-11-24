# @anbiq/engine-opencode

The [OpenCode](https://opencode.ai) agent engine for Anbiq. OpenCode talks to many model providers, so this one engine lets a factory run its crews on OpenAI, Google, OpenRouter, Anthropic, Groq, Mistral, DeepSeek, xAI and others.

The crews, their prompt and what each may do are the same as for every engine: they come from `@anbiq/core`. This package only spells the permissions as an OpenCode ruleset.

## Set up

1. In `anbiq.yml`, choose the engine and a model as `provider/model`. A model is required: OpenCode has no default provider.

   ```yaml
   engine: { id: opencode, model: openai/<model>, max_turns: 60, timeout_minutes: 60 }
   ```

2. In the repository the factory works on, add the provider's API key as an Actions secret. The workflow passes these on when they are set:

   | Provider   | Secret               |
   | ---------- | -------------------- |
   | OpenAI     | `OPENAI_API_KEY`     |
   | Google     | `GEMINI_API_KEY`     |
   | OpenRouter | `OPENROUTER_API_KEY` |
   | Anthropic  | `ANTHROPIC_API_KEY`  |
   | Groq       | `GROQ_API_KEY`       |
   | Mistral    | `MISTRAL_API_KEY`    |
   | DeepSeek   | `DEEPSEEK_API_KEY`   |
   | xAI        | `XAI_API_KEY`        |

   For another provider, add its key to the `env` of the "Run the crew (opencode)" step in `anbiq-run.yml`.

3. Use the current [`anbiq-run.yml`](../runner-github-actions/templates/anbiq-run.yml), which has the OpenCode step.

OpenCode reports what each run cost for most providers, so `budgets.usd_per_day` works. Where a provider reports no price the cost is zero; leave `usd_per_day` out and rely on `jobs_per_day` and `concurrent_jobs`.

## How the crew is confined

`permissionRules` turns the crew's permissions into OpenCode rules, where the last matching rule wins:

1. Deny everything. A headless run has nobody to answer a prompt, so nothing is left to ask about. This also covers subagents, web tools and anything added later.
2. Allow what the stage is granted: reading and searching, writing its result file (or any file, for build and QA), the verify commands, and for the stages that have them `git add`, `git commit`, `git status`, `git diff` and `git log`.
3. Deny what no crew may do, last, so no allow rule overrides it: pushing, git remotes and config, `curl`, `wget`, `ssh`, printing the environment, web fetch and search, files outside the repository, `.env` files at any depth, and CI workflows.

The workflow starts OpenCode with `OPENCODE_CONFIG` pointing at these rules and `OPENCODE_DISABLE_PROJECT_CONFIG=1`, so config files, agents and plugins inside the repository are not loaded and cannot widen the permissions.

### What was checked, and what was not

Checked against OpenCode 2.4.1 (the version the workflow installs) with real headless runs:

- denied reads, edits and commands are refused, not asked about, and the run continues;
- a command line of several commands (`a && b`, `a; b`, `a | b`, `$(b)`) is refused unless every command in it is allowed;
- a file outside the repository cannot be read;
- with project config disabled, an `opencode.json`, `.opencode/opencode.json` and `.opencode/agents/*.md` in the repository are ignored.

Not confined by OpenCode's rules:

- **Output redirection.** An allowed command can write with `>` to a path the edit rules deny. The workflow covers the case that matters: a run whose commits touch `.github/workflows/` is failed and its commits are discarded, for every engine.
- **What the verify commands do.** A build crew can edit code that a verify command then runs. This is true for every engine. The crew job has a read-only token and no factory secrets for that reason, but the model provider's API key is in its environment.

Upgrading OpenCode means repeating these checks: change `OPENCODE_VERSION` and the version in the workflow together.

## Usage

```ts
import { OpenCodeEngine } from '@anbiq/engine-opencode';

const engine = new OpenCodeEngine();
```
