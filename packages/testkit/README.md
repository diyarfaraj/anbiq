# @anbiq/testkit

Fakes and conformance suites for building [Anbiq](https://github.com/diyarfaraj/anbiq) adapters.

- **Fakes** of every port: `FakeTap`, `FakeTracker`, `FakeGitHost`, `FakeRunner`, `FakeEngine`, `FakeDeployer`, `MemoryJobStore`, `MemoryEventSink`. Use them to test a factory end to end without any network.
- **Conformance suites** for Vitest. An adapter that passes its suite behaves the way the factory expects:
  - `describeTapConformance`;
  - `describeTrackerConformance`;
  - `describeGitHostConformance`;
  - `describeRunnerConformance`;
  - `describeJobStoreConformance`.

```ts
import { describeTapConformance } from '@anbiq/testkit';

describeTapConformance('MyChatTap', () => ({
  tap: new MyChatTap(options),
  signed: (input) => signedWebhook(input),
  unsigned: (input) => unsignedWebhook(input),
  nonMessage: () => someOtherEvent(),
}));
```

`vitest` is a peer dependency. See [writing an adapter](https://github.com/diyarfaraj/anbiq/blob/main/docs/writing-an-adapter.md).
