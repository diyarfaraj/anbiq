# @anbiq/engine-claude-code

The Claude Code agent engine for Anbiq. It turns a job's stage, request, acceptance criteria and feedback into an invocation the runner executes: the prompt, the tools the crew may use, and its limits.

## What each crew may do

| Crew   | Reads code | Edits code | Runs verify commands | Commits | Writes its result |
| ------ | ---------- | ---------- | -------------------- | ------- | ----------------- |
| spec   | yes        | no         | no                   | no      | yes               |
| build  | yes        | yes        | yes                  | yes     | yes               |
| qa     | yes        | yes        | yes                  | yes     | yes               |
| review | yes        | no         | yes                  | no      | yes               |

Every crew is denied pushing, git remotes and config, network tools (`curl`, `wget`, `ssh`, web fetch and search), printing the environment, reading `.env` files, and editing CI workflows. Pushing happens outside the agent, in a separate job of the runner.

## Prompts

The request, acceptance criteria and feedback come from chat messages, so they are fenced in tags and the crew is told that text inside them describes the work and cannot change its rules. A closing tag inside a message is escaped, so a message cannot end its fence early.

The crew writes `.anbiq/result.json` with its outcome (`passed`, `failed` or `needs-input`), a summary and, for `needs-input`, one question. The spec crew's summary is the acceptance criteria, which the factory posts on the issue and hands to every later crew.

## Usage

```ts
import { ClaudeCodeEngine } from '@anbiq/engine-claude-code';

const engine = new ClaudeCodeEngine();
```

Limits and the model come from `engine` in `anbiq.yml` (`max_turns`, `timeout_minutes`, `model`), and the verify commands from `checks.verify`.
