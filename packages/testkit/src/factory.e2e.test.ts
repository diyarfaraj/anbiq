import { describe, expect, it } from 'vitest';
import { createFactory, parseConfig, type RunResult } from '@anbiq/core';
import {
  FakeDeployer,
  FakeEngine,
  FakeGitHost,
  FakeRunner,
  FakeTracker,
  MemoryEventSink,
  MemoryJobStore,
} from './fakes/services.js';
import { FakeTap } from './fakes/tap.js';

const OWNER = 'U_OWNER';
const TEAMMATE = 'U_TEAM';

const YAML = `
project: acme
taps:
  slack: {}
people:
  - name: Owner
    ids: { slack: ${OWNER} }
    roles: [requester, approver]
  - name: Teammate
    ids: { slack: ${TEAMMATE} }
    roles: [requester]
tracker: fake
git_host: fake
runner: fake
engine: { id: fake-engine }
checks: { verify: ['pnpm test'] }
policy:
  confirm_commands: ['deploy production']
  deploy_environments: [staging, production]
  max_bounces: 2
budgets: { usd_per_day: 25, jobs_per_day: 3, concurrent_jobs: 1 }
`;

function setup(edit: (yaml: string) => string = (yaml) => yaml) {
  const parsed = parseConfig(edit(YAML));
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));

  const tap = new FakeTap('slack', 'secret');
  const tracker = new FakeTracker();
  const gitHost = new FakeGitHost();
  const runner = new FakeRunner();
  const store = new MemoryJobStore();
  const events = new MemoryEventSink();
  const deployer = new FakeDeployer();
  let clock = Date.parse('2026-11-23T10:00:00Z');
  let sequence = 0;

  const factory = createFactory({
    config: parsed.config,
    taps: [tap],
    tracker,
    gitHost,
    runner,
    engine: new FakeEngine(),
    store,
    deployer,
    events: [events],
    now: () => new Date((clock += 1000)),
    newId: () => `id${String(++sequence).padStart(6, '0')}`,
  });

  const say = (userId: string, text: string, thread = 'T1') =>
    factory.handleHttp('slack', tap.signedRequest({ userId, channel: 'C1', thread, text }));

  const finish = (outcome: RunResult['outcome'], extra: Partial<RunResult> = {}) => {
    const run = runner.last();
    return factory.handleRunResult({
      runId: run.runId,
      jobId: run.jobId,
      stage: run.stage,
      outcome,
      summary: `${run.stage} ${outcome}`,
      costUsd: 0.5,
      ...extra,
    });
  };

  const lastReply = (thread = 'T1') => tap.transcript(thread).at(-1);
  const stages = () => runner.started.map((run) => run.stage);

  /** Drives a new job all the way to awaiting-approval, reviewed at `sha`. */
  async function toApproval(sha = 'sha-1', thread = 'T1') {
    await say(OWNER, 'Add a copy-link button to the booking page', thread);
    await finish('passed'); // spec
    await finish('passed'); // build: opens the pull request
    const prId = [...gitHost.pullRequests.keys()].at(-1)!;
    gitHost.push(prId, sha, true);
    await finish('passed', { headSha: sha }); // qa
    await finish('passed', { headSha: sha }); // review
    return prId;
  }

  return {
    tap,
    tracker,
    gitHost,
    runner,
    store,
    events,
    deployer,
    factory,
    say,
    finish,
    lastReply,
    stages,
    toApproval,
  };
}

describe('a job from request to production', () => {
  it('runs every stage, waits for approval, merges, then deploys after confirmation', async () => {
    const f = setup();
    const prId = await f.toApproval('sha-1');

    expect(f.stages()).toEqual(['spec', 'build', 'qa', 'review']);
    expect(f.tracker.issues.size).toBe(1);
    expect(f.lastReply()).toMatch(/is ready for your review/);

    await f.say(OWNER, 'merge');
    expect(f.gitHost.pullRequests.get(prId)?.merged).toBe(true);
    expect(f.lastReply()).toMatch(/^Merged /);

    await f.say(OWNER, 'deploy production');
    expect(f.lastReply()).toBe('Reply "yes" to confirm: deploy production');
    expect(f.deployer.deployments).toEqual([]);

    await f.say(OWNER, 'yes');
    expect(f.deployer.deployments).toEqual([
      { jobId: expect.any(String), environment: 'production' },
    ]);
    expect(f.lastReply()).toMatch(/^Deployed .* to production$/);

    expect(f.events.kinds()).toEqual(
      expect.arrayContaining([
        'job.created',
        'run.started',
        'pr.opened',
        'approval.requested',
        'merged',
        'deployed',
      ]),
    );
  });

  it('passes the request to every crew and only opens one pull request', async () => {
    const f = setup();
    await f.toApproval();
    expect(f.gitHost.pullRequests.size).toBe(1);
    expect(
      f.runner.started.every((run) => run.invocation.prompt.includes('copy-link button')),
    ).toBe(true);
  });
});

describe('who can do what', () => {
  it('ignores people who are not on the allowlist, without replying', async () => {
    const f = setup();
    await f.say('U_STRANGER', 'delete the database');
    expect(f.tap.sent).toEqual([]);
    expect(f.runner.started).toEqual([]);
    expect(f.events.kinds()).toEqual(['request.rejected']);
  });

  it('rejects unsigned webhook requests before reading them', async () => {
    const f = setup();
    const result = await f.factory.handleHttp(
      'slack',
      f.tap.unsignedRequest({ userId: OWNER, channel: 'C1', thread: 'T1', text: 'do it' }),
    );
    expect(result.status).toBe(401);
    expect(f.runner.started).toEqual([]);
  });

  it('returns 404 for a tap that is not configured', async () => {
    const f = setup();
    expect((await f.factory.handleHttp('teams', f.tap.nonMessageRequest())).status).toBe(404);
  });

  it('does not let a requester merge', async () => {
    const f = setup();
    const prId = await f.toApproval();
    await f.say(TEAMMATE, 'merge');
    expect(f.lastReply()).toMatch(/approver role/);
    expect(f.gitHost.pullRequests.get(prId)?.merged).toBe(false);
  });

  it('refuses to merge a pull request that changed after review', async () => {
    const f = setup();
    const prId = await f.toApproval('sha-1');
    f.gitHost.push(prId, 'sha-2', true);
    await f.say(OWNER, 'merge');
    expect(f.lastReply()).toMatch(/changed after it was reviewed/);
    expect(f.gitHost.pullRequests.get(prId)?.merged).toBe(false);
  });

  it('only answers status while switched off', async () => {
    const f = setup((yaml) => `${yaml}enabled: false\n`);
    await f.say(OWNER, 'Add a button');
    expect(f.lastReply()).toMatch(/switched off/);
    await f.say(OWNER, 'status', 'T2');
    expect(f.lastReply('T2')).toBe('acme: switched off');
    expect(f.runner.started).toEqual([]);
  });
});

describe('revisions and failures', () => {
  it('sends a revision back to build with the feedback, and requires a fresh review', async () => {
    const f = setup();
    const prId = await f.toApproval('sha-1');
    await f.say(OWNER, 'revise: make the button larger');

    expect(f.runner.last().stage).toBe('build');
    expect(f.runner.last().invocation.prompt).toContain('make the button larger');
    const job = (await f.store.findByThread({ tap: 'slack', channel: 'C1', thread: 'T1' }))!;
    expect(job.revisions).toBe(1);
    expect(job.reviewedSha).toBeUndefined();

    await f.say(OWNER, 'merge');
    expect(f.gitHost.pullRequests.get(prId)?.merged).toBe(false);
  });

  it('bounces failed QA back to build, then hands over to a person after the limit', async () => {
    const f = setup();
    await f.say(OWNER, 'Add a button');
    await f.finish('passed'); // spec
    await f.finish('passed'); // build
    for (let attempt = 0; attempt < 2; attempt++) {
      await f.finish('failed'); // qa fails, back to build
      expect(f.runner.last().stage).toBe('build');
      await f.finish('passed'); // build again
    }
    await f.finish('failed'); // third QA failure is over max_bounces: 2
    expect(f.lastReply()).toMatch(/needs a person/);
    expect(f.runner.last().stage).toBe('qa');
  });

  it('asks the thread when a crew needs input, then resumes with the answer', async () => {
    const f = setup();
    await f.say(OWNER, 'Add a button');
    await f.finish('needs-input', { question: 'Which page should the button go on?' });
    expect(f.lastReply()).toMatch(/has a question/);

    await f.say(OWNER, 'The booking confirmation page');
    expect(f.runner.last().stage).toBe('spec');
    expect(f.runner.last().invocation.prompt).toContain('The booking confirmation page');
  });

  it('ignores results from a run that was replaced', async () => {
    const f = setup();
    await f.say(OWNER, 'Add a button');
    await f.finish('passed'); // spec
    const firstBuild = f.runner.last();
    await f.say(OWNER, 'revise: use the brand colour'); // cancels the build run and starts a new one
    expect(f.runner.cancelled).toEqual([firstBuild.runId]);

    await f.factory.handleRunResult({
      runId: firstBuild.runId,
      jobId: firstBuild.jobId,
      stage: 'build',
      outcome: 'passed',
      summary: 'stale',
      costUsd: 0,
    });
    expect(f.gitHost.pullRequests.size).toBe(0);
    expect(f.runner.last().stage).toBe('build');
  });

  it('tells people to use a command when they write in an active job thread', async () => {
    const f = setup();
    await f.say(OWNER, 'Add a button');
    await f.say(OWNER, 'also make it blue');
    expect(f.lastReply()).toMatch(/This thread belongs to/);
    expect(f.tracker.issues.size).toBe(1);
  });
});

describe('budgets', () => {
  it('queues a second job until the running one stops needing a crew', async () => {
    const f = setup();
    await f.say(OWNER, 'First job', 'T1');
    await f.say(OWNER, 'Second job', 'T2');
    expect(f.lastReply('T2')).toMatch(/is queued/);
    expect(f.runner.started).toHaveLength(1);

    await f.finish('passed'); // job 1 spec, then job 1 build takes the slot
    expect(f.runner.last().jobId).toBe(f.runner.started[0]!.jobId);
    expect(f.runner.started).toHaveLength(2);

    await f.finish('needs-input', { question: 'Which colour?' }); // job 1 blocks, freeing the slot
    expect(f.runner.last().stage).toBe('spec');
    expect(f.runner.last().jobId).not.toBe(f.runner.started[0]!.jobId);
  });

  it('refuses new jobs once the daily job limit is reached', async () => {
    const f = setup();
    for (const thread of ['T1', 'T2', 'T3']) {
      await f.say(OWNER, `Job in ${thread}`, thread);
    }
    await f.say(OWNER, 'One job too many', 'T4');
    expect(f.lastReply('T4')).toMatch(/daily limit of 3 jobs/);
    expect(f.tracker.issues.size).toBe(3);
  });
});
