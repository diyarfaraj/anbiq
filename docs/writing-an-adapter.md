# Writing an adapter

An adapter connects Anbiq to one outside service: a chat app (a **tap**), a tracker, a git host, a runner, an agent engine, a deployer or a job store. The core never imports an adapter. It only knows the interfaces in [`packages/core/src/ports.ts`](../packages/core/src/ports.ts).

## Start from the fakes

`@anbiq/testkit` contains an in-memory implementation of every interface. They are the reference implementations: small, complete and tested against the same conformance suites as real adapters. Read the fake for your slot before you start.

| Slot      | Interface     | Reference fake    | Conformance suite             |
| --------- | ------------- | ----------------- | ----------------------------- |
| Tap       | `Tap`         | `FakeTap`         | `describeTapConformance`      |
| Tracker   | `Tracker`     | `FakeTracker`     | `describeTrackerConformance`  |
| Git host  | `GitHost`     | `FakeGitHost`     | `describeGitHostConformance`  |
| Runner    | `Runner`      | `FakeRunner`      | `describeRunnerConformance`   |
| Job store | `JobStore`    | `MemoryJobStore`  | `describeJobStoreConformance` |
| Engine    | `AgentEngine` | `FakeEngine`      | none yet                      |
| Deployer  | `Deployer`    | `FakeDeployer`    | none yet                      |
| Events    | `EventSink`   | `MemoryEventSink` | none yet                      |

## Package layout

Create `packages/<slot>-<service>`, for example `packages/tap-slack`:

```
packages/tap-slack/
  package.json        name "@anbiq/tap-slack", private until v0.1, depends on "@anbiq/core": "workspace:*"
  tsconfig.json       extends ../../tsconfig.base.json (copy from packages/testkit)
  tsconfig.build.json excludes src/**/*.test.ts
  src/index.ts        exports the adapter class
  src/conformance.test.ts
```

## Pass the conformance suite

Call your slot's suite from `src/conformance.test.ts`, with a harness that knows how to talk to your adapter:

```ts
import { describeTapConformance } from '@anbiq/testkit';
import { SlackTap } from './index.js';

describeTapConformance('SlackTap', () => {
  const tap = new SlackTap({ signingSecret: 'test-secret', client: fakeSlackClient() });
  return {
    tap,
    signed: (input) => slackEventRequest(input, 'test-secret'),
    unsigned: (input) => slackEventRequest(input, undefined),
    nonMessage: () => slackUrlVerificationRequest('test-secret'),
  };
});
```

Conformance tests never call the real service. Fake the platform's HTTP API in the test, and keep any live smoke test in a separate file that only runs when its credentials are present.

## Rules every adapter follows

- **Verify before reading.** A tap checks the platform's signature (and timestamp, where the platform provides one) in `verify`, and `parse` never runs on an unverified request.
- **Stable IDs only.** `InboundMessage.userId` is the platform's permanent user ID, never a display name or a handle that can change.
- **Degrade, don't fail.** If the platform has no buttons, no threads or a short message limit, render what it can: actions become text commands, long text is split or trimmed.
- **No secrets in events or errors.** Adapters never put tokens, message bodies from private channels, source code or full logs into events, error messages or logs.
- **Least privilege.** Document exactly which scopes or permissions the adapter needs and why, and ask for nothing more.
