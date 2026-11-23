import {
  describeGitHostConformance,
  describeJobStoreConformance,
  describeRunnerConformance,
  describeTapConformance,
  describeTrackerConformance,
} from './conformance/index.js';
import { FakeGitHost, FakeRunner, FakeTracker, MemoryJobStore } from './fakes/services.js';
import { FakeTap } from './fakes/tap.js';

// The fakes are the reference implementations: they must pass the same suites as real adapters.

describeTapConformance('FakeTap', () => {
  const tap = new FakeTap('fake', 'secret');
  return {
    tap,
    signed: (input) => tap.signedRequest(input),
    unsigned: (input) => tap.unsignedRequest(input),
    nonMessage: () => tap.nonMessageRequest(),
  };
});

describeTrackerConformance('FakeTracker', () => new FakeTracker());

describeGitHostConformance('FakeGitHost', () => {
  const gitHost = new FakeGitHost();
  return { gitHost, push: async (pr, sha) => gitHost.push(pr.id, sha) };
});

describeRunnerConformance('FakeRunner', () => new FakeRunner());

describeJobStoreConformance('MemoryJobStore', () => new MemoryJobStore());
