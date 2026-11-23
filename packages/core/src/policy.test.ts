import { describe, expect, it } from 'vitest';
import type { Command } from './command.js';
import { findPerson } from './identity.js';
import { createJob, type Job } from './job.js';
import { decide, type PolicyContext } from './policy.js';
import type { Stage } from './stage.js';
import { validConfig } from './__fixtures__/config.js';

const config = validConfig();
const owner = findPerson(config, 'slack', 'U012ABCDEF');
const teammate = findPerson(config, 'slack', 'U034GHIJKL');

function jobIn(stage: Stage, overrides: Partial<Job> = {}): Job {
  return {
    ...createJob({
      id: 'acme-web#7',
      project: 'acme-web',
      title: 't',
      requestedBy: 'Teammate',
      at: 'now',
    }),
    stage,
    ...overrides,
  };
}

const greenPr = { checksPassed: true, headSha: 'abc123', reviewedSha: 'abc123' };

function outcome(command: Command, ctx: Partial<PolicyContext>): string {
  return decide(command, { config, person: owner, ...ctx }).outcome;
}

describe('identity', () => {
  it('finds people by tap user ID only', () => {
    expect(owner?.name).toBe('Owner');
    expect(findPerson(config, 'whatsapp-twilio', '+15550123')?.name).toBe('Owner');
    expect(findPerson(config, 'slack', 'Owner')).toBeUndefined();
    expect(findPerson(config, 'teams', 'U012ABCDEF')).toBeUndefined();
  });
});

describe('decide', () => {
  it('denies everyone who is not on the allowlist, even for status', () => {
    expect(outcome({ type: 'status' }, { person: undefined })).toBe('deny');
  });

  it('lets any known person ask for status, even when switched off', () => {
    const off = validConfig({ enabled: false });
    expect(decide({ type: 'status' }, { config: off, person: teammate }).outcome).toBe('allow');
  });

  it('denies everything else when the project is switched off', () => {
    const off = validConfig({ enabled: false });
    const decision = decide({ type: 'request', text: 'x' }, { config: off, person: owner });
    expect(decision).toEqual({ outcome: 'deny', reason: expect.stringMatching(/switched off/) });
  });

  describe('request', () => {
    it('needs the requester role', () => {
      expect(outcome({ type: 'request', text: 'x' }, { person: teammate })).toBe('allow');
      const watcher = { name: 'Watcher', roles: ['approver'] as const };
      expect(outcome({ type: 'request', text: 'x' }, { person: watcher })).toBe('deny');
    });
  });

  describe('merge', () => {
    it('allows an approver once checks pass on the reviewed commit', () => {
      expect(
        outcome({ type: 'merge' }, { job: jobIn('awaiting-approval'), pullRequest: greenPr }),
      ).toBe('allow');
    });

    it('refuses a requester without the approver role', () => {
      expect(
        outcome(
          { type: 'merge' },
          { person: teammate, job: jobIn('awaiting-approval'), pullRequest: greenPr },
        ),
      ).toBe('deny');
    });

    it('refuses a job that is not awaiting approval', () => {
      expect(outcome({ type: 'merge' }, { job: jobIn('review'), pullRequest: greenPr })).toBe(
        'deny',
      );
    });

    it('refuses failing checks', () => {
      const red = { ...greenPr, checksPassed: false };
      expect(
        outcome({ type: 'merge' }, { job: jobIn('awaiting-approval'), pullRequest: red }),
      ).toBe('deny');
    });

    it('refuses a pull request that changed after review, or was never reviewed', () => {
      const moved = { ...greenPr, headSha: 'def456' };
      expect(
        outcome({ type: 'merge' }, { job: jobIn('awaiting-approval'), pullRequest: moved }),
      ).toBe('deny');
      const unreviewed = { checksPassed: true, headSha: 'abc123' };
      expect(
        outcome({ type: 'merge' }, { job: jobIn('awaiting-approval'), pullRequest: unreviewed }),
      ).toBe('deny');
    });

    it('refuses when there is no job or no pull request', () => {
      expect(outcome({ type: 'merge' }, {})).toBe('deny');
      expect(outcome({ type: 'merge' }, { job: jobIn('awaiting-approval') })).toBe('deny');
    });
  });

  describe('deploy', () => {
    it('asks for confirmation before production, then allows it', () => {
      const ctx = { job: jobIn('merged') };
      const deploy: Command = { type: 'deploy', environment: 'production' };
      expect(outcome(deploy, ctx)).toBe('confirm');
      expect(outcome(deploy, { ...ctx, confirmed: true })).toBe('allow');
    });

    it('allows staging without confirmation', () => {
      expect(outcome({ type: 'deploy', environment: 'staging' }, { job: jobIn('merged') })).toBe(
        'allow',
      );
    });

    it('refuses unknown environments and unmerged jobs', () => {
      expect(outcome({ type: 'deploy', environment: 'moon' }, { job: jobIn('merged') })).toBe(
        'deny',
      );
      expect(outcome({ type: 'deploy', environment: 'staging' }, { job: jobIn('review') })).toBe(
        'deny',
      );
    });

    it('needs the approver role', () => {
      expect(
        outcome(
          { type: 'deploy', environment: 'staging' },
          { person: teammate, job: jobIn('merged') },
        ),
      ).toBe('deny');
    });
  });

  describe('revise', () => {
    it('allows revising a job in progress or awaiting approval', () => {
      for (const stage of ['build', 'qa', 'review', 'awaiting-approval'] as const) {
        expect(
          outcome({ type: 'revise', text: 'x' }, { person: teammate, job: jobIn(stage) }),
        ).toBe('allow');
      }
    });

    it('caps revisions so a person takes over', () => {
      const tired = jobIn('awaiting-approval', { revisions: 3 });
      expect(outcome({ type: 'revise', text: 'x' }, { job: tired })).toBe('deny');
    });

    it('refuses finished jobs', () => {
      expect(outcome({ type: 'revise', text: 'x' }, { job: jobIn('merged') })).toBe('deny');
    });
  });

  describe('cancel', () => {
    it('lets the requester cancel their own job', () => {
      expect(outcome({ type: 'cancel' }, { person: teammate, job: jobIn('build') })).toBe('allow');
    });

    it("refuses a requester cancelling someone else's job", () => {
      const ownersJob = jobIn('build', { requestedBy: 'Owner' });
      expect(outcome({ type: 'cancel' }, { person: teammate, job: ownersJob })).toBe('deny');
    });

    it('lets an approver cancel any unfinished job, but not a merged one', () => {
      expect(outcome({ type: 'cancel' }, { job: jobIn('qa') })).toBe('allow');
      expect(outcome({ type: 'cancel' }, { job: jobIn('merged') })).toBe('deny');
    });
  });
});
