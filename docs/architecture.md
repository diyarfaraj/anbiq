# Architecture

This document describes how Anbiq is meant to work. It is a design, not a description of existing code, and it will change as the first modules are built.

## Goals

- Start software work from any chat app, and get the result back in the same conversation.
- Keep a person in charge of every merge and every deploy.
- Make every external service replaceable without touching the core.
- Keep the agent's access as small as possible.

## Terms

| Term        | Meaning                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Request** | A message asking for work, from any tap.                                                                                                              |
| **Job**     | One unit of work, created from a request. Every job is an issue in the tracker.                                                                       |
| **Stage**   | Where a job is in the pipeline: `intake`, `spec`, `build`, `qa`, `review`, `awaiting-approval`, `merged`, `deployed`, plus `blocked` and `cancelled`. |
| **Run**     | One execution of one stage on a runner. A run never waits for a person: it ends, and a person's later reply starts a new run.                         |
| **Crew**    | The agent role that does a stage's work (spec, build, QA, review).                                                                                    |
| **Policy**  | Per-project rules: who may request and approve, which checks must pass, which paths need a person, and budgets.                                       |

## Components

```
            ┌──────────────── core ────────────────┐
 taps ────► │ identity · commands · jobs · policy  │ ────► tracker
 (chat)     │ budgets · conversation ↔ job mapping │ ────► git host
     ◄────  │ message rendering                    │ ────► runner ──► agent engine
            └──────────────────┬───────────────────┘
                               └────► event sinks (live board, OpenTelemetry)
```

The **core** knows nothing about any specific chat app, tracker, git host, runner or agent. It owns:

- **Identity:** maps a tap's user ID to a factory identity with roles (`requester`, `approver`). It never uses display names.
- **Commands:** parses one shared command set across all taps. A request is any message that is not a command. Commands are `revise: <text>`, `merge`, `deploy <environment>`, `status` and `cancel`.
- **Jobs:** links each conversation thread to one job, and moves jobs between stages.
- **Policy:** checks every command against the project's rules before acting.
- **Budgets:** enforces caps on cost, turns, run time, concurrent jobs and jobs per day.
- **Rendering:** turns a neutral message (title, fields, links, optional actions) into something each tap can display.

## Interfaces

Each slot is a small TypeScript interface. The examples below are sketches; the real definitions will be refined when the first adapters are built.

### Tap (chat channel)

```ts
interface Tap {
  id: string; // "slack", "whatsapp-twilio", ...
  capabilities: {
    threads: boolean;
    actions: boolean; // buttons or similar
    editMessages: boolean;
    maxLength: number;
    replyWindowHours?: number; // e.g. WhatsApp's 24-hour customer-service window
  };
  verify(req: InboundHttpRequest): Promise<boolean>; // platform signature check
  parse(req: InboundHttpRequest): Promise<InboundMessage | null>; // sender, thread, text
  send(thread: ThreadRef, msg: OutboundMessage): Promise<void>;
}
```

A tap must degrade gracefully. Without buttons, actions become text commands. Without threads, messages carry the job reference. Outside a reply window, it uses the platform's approved templates.

### Tracker

```ts
interface Tracker {
  createJob(input: { title: string; body: string; meta: JobMeta }): Promise<JobRef>;
  comment(job: JobRef, body: string): Promise<void>;
  setStage(job: JobRef, stage: Stage): Promise<void>;
  claim(job: JobRef, runId: string): Promise<boolean>; // stops two runs working the same job
}
```

### Git host

```ts
interface GitHost {
  openPullRequest(input: PullRequestInput): Promise<PullRequestRef>;
  checksPassed(pr: PullRequestRef): Promise<boolean>;
  merge(pr: PullRequestRef, expectedHeadSha: string): Promise<void>; // refuses if the head moved
}
```

### Runner and agent engine

```ts
interface Runner {
  start(run: RunSpec): Promise<RunRef>; // RunSpec: job, stage, engine, limits, allowed tools
  cancel(run: RunRef): Promise<void>;
}

interface AgentEngine {
  id: string; // "claude-code", ...
  prepare(run: RunSpec): EngineInvocation; // prompt template, tool allowlist, limits
}
```

The runner decides where a run executes. The engine decides how the agent is invoked. Each run receives only the credentials its stage needs, and never deploy or production credentials.

### Event sink

```ts
interface EventSink {
  emit(event: FactoryEvent): Promise<void>;
}
```

## Events

Everything that happens is an event, which drives the live board and the audit trail. Events carry metadata only: never source code, secrets or full logs.

```json
{
  "v": 1,
  "id": "evt_01J…",
  "at": "2026-11-23T14:02:07Z",
  "project": "acme-web",
  "job": "acme-web#1142",
  "stage": "build",
  "kind": "tool.started",
  "actor": { "type": "crew", "role": "build", "run": "run_01J…" },
  "summary": "Running unit tests",
  "links": { "issue": "https://…", "pr": null, "run": "https://…" },
  "cost": { "usd": 0.04 }
}
```

Planned kinds include:

- `request.received` and `job.created`;
- `stage.entered`;
- `run.started` and `run.finished`;
- `tool.started` and `tool.finished`;
- `pr.opened` and `checks.finished`;
- `approval.requested`, `approval.given` and `approval.rejected`;
- `merged`, `deployed` and `budget.exceeded`.

## Configuration

Each project has one file in its repository, for example `anbiq.yml`:

```yaml
project: acme-web
taps:
  slack:
    channel: '#factory'
  whatsapp-twilio:
    numbers: ['+15550100']
people:
  - name: Owner
    ids: # keyed by tap; display names are never used
      slack: U012ABCDEF
      whatsapp-twilio: '+15550123'
    roles: [requester, approver]
tracker: github-issues
git_host: github
runner: github-actions
engine:
  id: claude-code
  model: <model id>
  max_turns: 60
  timeout_minutes: 60
checks:
  verify: ['pnpm install --frozen-lockfile', 'pnpm test', 'pnpm lint']
policy:
  merge: human # agents never merge
  deploy: human
  human_review_paths: ['infra/**', '.github/workflows/**', '**/migrations/**']
  confirm_commands: ['deploy production'] # asks for a second confirmation
  deploy_environments: [staging, production]
  max_revisions: 3 # then a person takes over
budgets:
  usd_per_day: 25
  jobs_per_day: 10
  concurrent_jobs: 1
enabled: true # the kill switch
```

## Security model

See [SECURITY.md](../SECURITY.md) for the rules every module must follow. In particular:

- Each tap verifies the platform's signature on every request.
- The core accepts only allowlisted identities.
- Request text reaches the agent as data, never as instructions with authority.
- The runner never passes deploy or production credentials to an agent.
- Merges check that the reviewed commit is still the head of the pull request.

## Packaging

The project will be a TypeScript monorepo published under the `@anbiq` npm scope:

- `@anbiq/core`;
- one package per adapter, for example `@anbiq/tap-slack`, `@anbiq/tap-whatsapp-twilio`, `@anbiq/tracker-github`, `@anbiq/runner-github-actions` and `@anbiq/engine-claude-code`;
- `@anbiq/board` for the live board.

Each slot has a shared conformance test suite that every adapter must pass.

## Open questions

- How should a project run the core: a small long-running service, serverless functions, or both?
- How should approvals work on channels with weak identity, for example a second confirmation or a different channel for production deploys?
- iMessage has no open API. Apple Messages for Business requires Apple's approval, and local bridges are unofficial. It stays experimental until there is a sound option.
