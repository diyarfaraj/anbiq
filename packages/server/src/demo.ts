import { randomBytes } from 'node:crypto';
import {
  createFactory,
  parseConfig,
  type AgentEngine,
  type AnbiqConfig,
  type CrewStage,
  type Deployer,
  type EngineInvocation,
  type Factory,
  type GitHost,
  type IssueRef,
  type JobRecord,
  type PullRequestRef,
  type RunRef,
  type RunResult,
  type RunSpec,
  type Runner,
  type Tap,
  type ThreadRef,
  type Tracker,
} from '@anbiq/core';
import { SqliteEventSink } from './events.js';
import type { Logger } from './log.js';
import { SerialQueue } from './queue.js';
import { SqliteDatabase, SqliteJobStore } from './sqlite.js';

/**
 * Demo mode: the real factory, with simulated chat, GitHub, crews and people. Every job, stage
 * change and event on the board comes from the factory itself; only the outside world is made up.
 */

const DEMO_CONFIG = `
project: acme-web
taps: { demo: {} }
people:
  - name: Dana
    ids: { demo: dana }
    roles: [requester, approver]
  - name: Sam
    ids: { demo: sam }
    roles: [requester]
tracker: demo
git_host: demo
runner: demo
engine: { id: demo }
checks: { verify: ['pnpm test'] }
policy:
  confirm_commands: ['deploy production']
  deploy_environments: [staging, production]
  max_revisions: 2
  max_bounces: 2
budgets: { usd_per_day: 25, jobs_per_day: 500, concurrent_jobs: 3 }
`;

const REQUESTS = [
  'Add a copy-link button to the booking confirmation page',
  'Show the weekday in the calendar header',
  'Send an SMS reminder two hours before each appointment',
  'Export the customer list as CSV',
  'Stop the flaky staff-schedule test',
  'Let customers pick a preferred staff member',
  'Add Swedish to the voice receptionist',
  'Show a deposit badge on paid bookings',
  'Dark mode for the dashboard',
  'Warn before double-booking a room',
  'Weekly revenue email for owners',
  'Remember the last-used service on rebooking',
];

const QUESTIONS = [
  'Should this apply to every location, or only the main one?',
  'Should staff see it too, or only owners?',
];

const SUMMARIES: Record<CrewStage, string[]> = {
  spec: [
    '1. The button is shown on the confirmation page.\n2. It copies the booking link.\n3. A toast confirms the copy.\n4. It works on mobile.',
    '1. The new option is off by default.\n2. Owners can switch it on in settings.\n3. Existing bookings are unaffected.',
  ],
  build: [
    'Changed 4 files. Added 6 tests; all 1,912 tests pass.',
    'Changed 3 files. Added 4 tests first, then the change; lint and typecheck pass.',
  ],
  qa: [
    'Every acceptance criterion has a passing test. No security issues in the diff.',
    'All criteria proven; added 2 tests for empty and error states.',
  ],
  review: [
    'Ready to merge: does only what was asked, tests cover every criterion, no risky changes.',
    'Ready to merge. Re-ran QA, tried counterexamples, checked the project rules.',
  ],
};

const FAILURES: Partial<Record<CrewStage, string>> = {
  qa: 'Criterion 3 has no test, and the error state is not handled. Build crew: add both.',
  review: 'The change also renames an unrelated helper. Revert that and keep the diff focused.',
};

export interface DemoOptions {
  logger: Logger;
  /** Multiplies every delay; 1 is real time, smaller is faster (tests use a tiny value). */
  pace?: number;
  random?: () => number;
}

export interface Demo {
  factory: Factory;
  queue: SerialQueue;
  database: SqliteDatabase;
  store: SqliteJobStore;
  events: SqliteEventSink;
  config: AnbiqConfig;
  start(): void;
  stop(): void;
}

export function createDemo(options: DemoOptions): Demo {
  const parsed = parseConfig(DEMO_CONFIG);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  const config = parsed.config;
  const pace = options.pace ?? 1;
  const random = options.random ?? Math.random;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const between = (min: number, max: number) => (min + random() * (max - min)) * 1000 * pace;

  const database = new SqliteDatabase(':memory:');
  const store = new SqliteJobStore(database);
  const events = new SqliteEventSink(database);
  const queue = new SerialQueue(options.logger);
  const timers = new Set<NodeJS.Timeout>();
  let running = false;

  const later = (ms: number, task: () => Promise<void> | void) => {
    if (!running) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (running) queue.defer(async () => task(), 'demo step');
    }, ms);
    timers.add(timer);
  };

  let issueNumber = 214;
  const tracker: Tracker = {
    async createJob() {
      const id = String(++issueNumber);
      return { id, url: `https://github.com/acme/web/issues/${id}` } satisfies IssueRef;
    },
    async comment() {},
    async setStage() {},
    async claim() {
      return true;
    },
    async release() {},
  };

  const heads = new Map<string, string>();
  const gitHost: GitHost = {
    async openPullRequest(input) {
      const id = String(++issueNumber);
      heads.set(id, shaFor(input.jobId));
      return { id, url: `https://github.com/acme/web/pull/${id}` } satisfies PullRequestRef;
    },
    async pullRequestState(pr) {
      return { checksPassed: true, headSha: heads.get(pr.id) ?? 'unknown' };
    },
    async merge() {},
  };

  const engine: AgentEngine = {
    id: 'demo',
    prepare(input): EngineInvocation {
      return {
        engine: 'demo',
        prompt: input.request,
        settings: {},
        maxTurns: 1,
        timeoutMinutes: 1,
      };
    },
  };

  const deployer: Deployer = {
    async deploy(input) {
      return { url: `https://${input.environment}.acme.example` };
    },
  };

  const asked = new Set<string>();
  const failed = new Set<string>();
  let runNumber = 9000;
  const runner: Runner = {
    async start(spec: RunSpec): Promise<RunRef> {
      const id = spec.runId;
      const duration = spec.stage === 'build' ? between(14, 26) : between(7, 15);
      later(duration, () => factory.handleRunResult(resultFor(spec)));
      return { id, url: `https://github.com/acme/web/actions/runs/${++runNumber}` };
    },
    async cancel() {},
  };

  function resultFor(spec: RunSpec): RunResult {
    const base = {
      runId: spec.runId,
      jobId: spec.jobId,
      stage: spec.stage,
      costUsd:
        Math.round((spec.stage === 'build' ? 0.3 + random() * 0.5 : 0.05 + random() * 0.25) * 100) /
        100,
      headSha: shaFor(spec.jobId),
    };
    if (spec.stage === 'spec' && !asked.has(spec.jobId) && random() < 0.2) {
      asked.add(spec.jobId);
      const question = pick(QUESTIONS);
      return { ...base, outcome: 'needs-input', summary: question, question };
    }
    const failure = FAILURES[spec.stage];
    const key = `${spec.jobId}:${spec.stage}`;
    if (failure && !failed.has(key) && random() < (spec.stage === 'qa' ? 0.3 : 0.15)) {
      failed.add(key);
      return { ...base, outcome: 'failed', summary: failure };
    }
    return { ...base, outcome: 'passed', summary: pick(SUMMARIES[spec.stage]) };
  }

  const tap: Tap = {
    id: 'demo',
    capabilities: { threads: true, actions: false, editMessages: false, maxLength: 10_000 },
    async verify() {
      return false;
    },
    async parse() {
      return null;
    },
    async send() {},
  };

  const factory = createFactory({
    config,
    taps: [tap],
    tracker,
    gitHost,
    runner,
    engine,
    store,
    deployer,
    events: [events],
  });

  let messageNumber = 0;
  let threadNumber = 0;
  const say = (person: 'dana' | 'sam', thread: ThreadRef, text: string) =>
    factory.handleMessage({
      tap: 'demo',
      messageId: `demo-${++messageNumber}`,
      userId: person,
      thread,
      text,
      receivedAt: new Date().toISOString(),
    });

  let nextRequest = 0;
  async function request(): Promise<void> {
    const text = REQUESTS[nextRequest++ % REQUESTS.length]!;
    const thread = { tap: 'demo', channel: 'factory', thread: `t${++threadNumber}` };
    await say(random() < 0.6 ? 'dana' : 'sam', thread, text);
  }

  /** People reacting to the factory: answering questions, approving, revising and deploying. */
  const handled = new Set<string>();
  async function react(): Promise<void> {
    const jobs = store.listRecent(100);
    const open = jobs.filter((job) => !['merged', 'deployed', 'cancelled'].includes(job.stage));
    for (const job of jobs) respond(job);
    if (open.length < 6 && random() < 0.35) await request();
    later(between(3, 5), react);
  }

  function respond(job: JobRecord): void {
    const key = `${job.id}:${job.stage}:${job.revisions}:${job.bounces}`;
    if (handled.has(key)) return;
    if (job.stage === 'blocked') {
      handled.add(key);
      later(between(5, 10), () => say('dana', job.thread, 'Only the main location for now.'));
    } else if (job.stage === 'awaiting-approval') {
      handled.add(key);
      const revise = job.revisions === 0 && random() < 0.25;
      later(between(8, 16), () =>
        say('dana', job.thread, revise ? 'revise: make the button larger on mobile' : 'merge'),
      );
    } else if (job.stage === 'merged') {
      handled.add(key);
      if (random() < 0.6) {
        const production = random() < 0.5;
        later(between(10, 20), async () => {
          await say('dana', job.thread, production ? 'deploy production' : 'deploy staging');
          if (production) later(between(2, 4), () => say('dana', job.thread, 'yes'));
        });
      }
    }
  }

  return {
    factory,
    queue,
    database,
    store,
    events,
    config,
    start() {
      running = true;
      for (let i = 0; i < 4; i++) later(between(0.5 + i * 2, 1 + i * 2), request);
      later(between(4, 5), react);
    },
    stop() {
      running = false;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

function shaFor(jobId: string): string {
  return `demo${Buffer.from(jobId).toString('hex')}`.padEnd(40, '0').slice(0, 40);
}

/** A random password and secrets for the demo's board session; the demo board is open anyway. */
export const demoSecret = (): string => randomBytes(32).toString('base64url');
