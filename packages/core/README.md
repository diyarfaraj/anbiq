# @anbiq/core

The core of [Anbiq](https://github.com/diyarfaraj/anbiq), an open-source software factory: a request from chat becomes a tracked job, coding agents spec, build, test and review it, and a person approves every merge and deploy.

This package has no I/O. It holds:

- **the job model:** stages, transitions, revisions and bounces;
- **`anbiq.yml` parsing and validation:** `parseConfig`;
- **commands and policy:** `parseCommand`, and `decide`, which says who may request, revise, merge, deploy or cancel;
- **budgets:** jobs per day, spend per day, concurrent crews;
- **ports:** `Tap`, `Tracker`, `GitHost`, `Runner`, `AgentEngine`, `JobStore`, `Deployer`, `EventSink`;
- **`createFactory`:** the orchestrator that wires the ports together;
- **shared tap helpers:** `ConversationMemory`, `renderPlainText`, `chunkText`, `requestHeader`.

```ts
import { createFactory, parseConfig } from '@anbiq/core';

const parsed = parseConfig(readFileSync('anbiq.yml', 'utf8'));
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const factory = createFactory({
  config: parsed.config,
  taps,
  tracker,
  gitHost,
  runner,
  engine,
  store,
});
```

To run Anbiq rather than embed it, use [`@anbiq/server`](https://www.npmjs.com/package/@anbiq/server). To write your own adapter, see [writing an adapter](https://github.com/diyarfaraj/anbiq/blob/main/docs/writing-an-adapter.md) and [`@anbiq/testkit`](https://www.npmjs.com/package/@anbiq/testkit).
