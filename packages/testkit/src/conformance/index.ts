import { describe, expect, it } from 'vitest';
import {
  HeadMovedError,
  createJob,
  type GitHost,
  type InboundHttpRequest,
  type JobRecord,
  type JobStore,
  type PullRequestRef,
  type Runner,
  type Tap,
  type Tracker,
} from '@anbiq/core';

// Every adapter for a slot must pass that slot's suite. Call the suite from the
// adapter's own test file with a harness that knows how to talk to the adapter.

export interface TapHarness {
  tap: Tap;
  signed(input: {
    userId: string;
    channel: string;
    thread: string;
    text: string;
  }): InboundHttpRequest;
  unsigned(input: {
    userId: string;
    channel: string;
    thread: string;
    text: string;
  }): InboundHttpRequest;
  nonMessage(): InboundHttpRequest;
  /**
   * False for platforms that authenticate webhooks with a shared secret header but do not
   * sign the body (Telegram). The tamper test is skipped for them, and their README says so.
   */
  signsBody?: boolean;
}

export function describeTapConformance(name: string, setup: () => TapHarness): void {
  describe(`${name}: tap conformance`, () => {
    // Numeric IDs, because some platforms (Telegram, Discord) only have numeric ones.
    const input = { userId: '1001', channel: 'C1', thread: 'T1', text: 'add a copy-link button' };

    it('verifies a correctly signed request', async () => {
      const h = setup();
      expect(await h.tap.verify(h.signed(input))).toBe(true);
    });

    it('rejects an unsigned request', async () => {
      const h = setup();
      expect(await h.tap.verify(h.unsigned(input))).toBe(false);
    });

    it.skipIf(setup().signsBody === false)(
      'rejects a request whose body changed after signing',
      async () => {
        const h = setup();
        const request = h.signed(input);
        const tampered = { ...request, body: request.body.replace('copy-link', 'delete-all') };
        expect(await h.tap.verify(tampered)).toBe(false);
      },
    );

    it('parses the sender, thread and text of a message', async () => {
      const h = setup();
      const message = await h.tap.parse(h.signed(input));
      expect(message).not.toBeNull();
      expect(message?.tap).toBe(h.tap.id);
      expect(message?.userId).toBe('1001');
      expect(message?.text).toBe('add a copy-link button');
    });

    it('gives replies in the same conversation the same thread', async () => {
      const h = setup();
      const first = await h.tap.parse(h.signed(input));
      const second = await h.tap.parse(h.signed({ ...input, text: 'status' }));
      expect(second?.thread).toEqual(first?.thread);
    });

    it('gives a repeated delivery of the same request the same message ID', async () => {
      const h = setup();
      const request = h.signed(input);
      const first = await h.tap.parse(request);
      const again = await h.tap.parse(request);
      expect(again?.messageId).toBe(first?.messageId);
    });

    it('returns null for platform events that are not messages', async () => {
      const h = setup();
      expect(await h.tap.parse(h.nonMessage())).toBeNull();
    });

    it('sends a message longer than the platform limit without throwing', async () => {
      const h = setup();
      const message = await h.tap.parse(h.signed(input));
      const long = 'x'.repeat(h.tap.capabilities.maxLength + 500);
      await expect(
        h.tap.send(message!.thread, { title: 'Long', body: long }),
      ).resolves.toBeUndefined();
    });
  });
}

export function describeTrackerConformance(name: string, setup: () => Tracker): void {
  describe(`${name}: tracker conformance`, () => {
    const job = { jobId: 'acme-1', title: 'Add a button', body: 'Please add a button.' };

    it('creates jobs with distinct references', async () => {
      const tracker = setup();
      const a = await tracker.createJob(job);
      const b = await tracker.createJob({ ...job, jobId: 'acme-2' });
      expect(a.id).not.toBe(b.id);
      expect(a.url).toMatch(/^https?:\/\//);
    });

    it('lets only one run claim a job at a time', async () => {
      const tracker = setup();
      const issue = await tracker.createJob(job);
      expect(await tracker.claim(issue, 'run-1')).toBe(true);
      expect(await tracker.claim(issue, 'run-2')).toBe(false);
      expect(await tracker.claim(issue, 'run-1')).toBe(true);
    });

    it('frees a job only when its holder releases it', async () => {
      const tracker = setup();
      const issue = await tracker.createJob(job);
      await tracker.claim(issue, 'run-1');
      await tracker.release(issue, 'run-2');
      expect(await tracker.claim(issue, 'run-2')).toBe(false);
      await tracker.release(issue, 'run-1');
      expect(await tracker.claim(issue, 'run-2')).toBe(true);
    });

    it('accepts stage changes and comments', async () => {
      const tracker = setup();
      const issue = await tracker.createJob(job);
      await expect(tracker.setStage(issue, 'build')).resolves.toBeUndefined();
      await expect(tracker.comment(issue, 'Build started')).resolves.toBeUndefined();
    });
  });
}

export interface GitHostHarness {
  gitHost: GitHost;
  /** Moves the pull request's head to a new commit, as a push would. */
  push(pr: PullRequestRef, headSha: string): Promise<void>;
}

export function describeGitHostConformance(name: string, setup: () => GitHostHarness): void {
  describe(`${name}: git host conformance`, () => {
    const input = {
      jobId: 'acme-1',
      branch: 'anbiq/abc',
      title: 'Add a button',
      body: 'Closes #1',
    };

    it('opens a pull request and reports its head', async () => {
      const h = setup();
      const pr = await h.gitHost.openPullRequest(input);
      await h.push(pr, 'sha-1');
      expect((await h.gitHost.pullRequestState(pr)).headSha).toBe('sha-1');
    });

    it('merges when the head is the expected commit', async () => {
      const h = setup();
      const pr = await h.gitHost.openPullRequest(input);
      await h.push(pr, 'sha-1');
      await expect(h.gitHost.merge(pr, 'sha-1')).resolves.toBeUndefined();
    });

    it('refuses to merge when the head moved', async () => {
      const h = setup();
      const pr = await h.gitHost.openPullRequest(input);
      await h.push(pr, 'sha-1');
      await h.push(pr, 'sha-2');
      await expect(h.gitHost.merge(pr, 'sha-1')).rejects.toBeInstanceOf(HeadMovedError);
    });
  });
}

export function describeRunnerConformance(name: string, setup: () => Runner): void {
  describe(`${name}: runner conformance`, () => {
    const spec = {
      runId: 'run-1',
      jobId: 'acme-1',
      stage: 'build' as const,
      branch: 'anbiq/abc',
      invocation: {
        engine: 'any',
        prompt: 'build it',
        allowedTools: [],
        maxTurns: 5,
        timeoutMinutes: 5,
      },
    };

    it('reports the run under the ID it was given', async () => {
      const runner = setup();
      expect((await runner.start(spec)).id).toBe('run-1');
    });

    it('cancels a started run', async () => {
      const runner = setup();
      const run = await runner.start(spec);
      await expect(runner.cancel(run)).resolves.toBeUndefined();
    });
  });
}

export function describeJobStoreConformance(name: string, setup: () => JobStore): void {
  describe(`${name}: job store conformance`, () => {
    function record(id: string, createdAt: string, extra: Partial<JobRecord> = {}): JobRecord {
      return {
        ...createJob({ id, project: 'acme', title: id, requestedBy: 'Owner', at: createdAt }),
        request: id,
        thread: { tap: 'slack', channel: 'C1', thread: id },
        branch: `anbiq/${id}`,
        bounces: 0,
        ...extra,
      };
    }

    it('returns what was saved, without sharing references', async () => {
      const store = setup();
      const job = record('a', '2026-11-23T08:00:00Z');
      await store.save(job);
      const loaded = await store.get('a');
      expect(loaded).toEqual(job);
      loaded!.title = 'changed';
      expect((await store.get('a'))?.title).toBe('a');
    });

    it('finds a job by its thread', async () => {
      const store = setup();
      await store.save(record('a', '2026-11-23T08:00:00Z'));
      expect((await store.findByThread({ tap: 'slack', channel: 'C1', thread: 'a' }))?.id).toBe(
        'a',
      );
      expect(
        await store.findByThread({ tap: 'slack', channel: 'C1', thread: 'zzz' }),
      ).toBeUndefined();
    });

    it('lists queued jobs oldest first', async () => {
      const store = setup();
      await store.save(record('late', '2026-11-23T09:00:00Z', { queued: { stage: 'build' } }));
      await store.save(record('early', '2026-11-23T08:00:00Z', { queued: { stage: 'spec' } }));
      await store.save(record('idle', '2026-11-23T07:00:00Z'));
      expect((await store.listQueued()).map((job) => job.id)).toEqual(['early', 'late']);
    });

    it('claims each delivered message only once', async () => {
      const store = setup();
      expect(await store.claimMessage('slack:C1:1700000000.0001')).toBe(true);
      expect(await store.claimMessage('slack:C1:1700000000.0001')).toBe(false);
      expect(await store.claimMessage('slack:C1:1700000000.0002')).toBe(true);
    });

    it("counts today's jobs and spend and the jobs running now", async () => {
      const store = setup();
      await store.save(record('yesterday', '2026-11-22T23:00:00Z'));
      await store.save(
        record('today', '2026-11-23T08:00:00Z', { activeRun: { id: 'r1', stage: 'build' } }),
      );
      await store.recordCost('today', 1.5, '2026-11-23T09:00:00Z');
      await store.recordCost('yesterday', 9, '2026-11-22T23:30:00Z');
      expect(await store.usage('2026-11-23T12:00:00Z')).toEqual({
        usdToday: 1.5,
        jobsToday: 1,
        runningJobs: 1,
      });
    });
  });
}
