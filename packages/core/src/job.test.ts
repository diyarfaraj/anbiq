import { describe, expect, it } from 'vitest';
import { InvalidTransitionError, canTransition, createJob, settle, transition } from './job.js';

const job = createJob({
  id: 'acme-web#1',
  project: 'acme-web',
  title: 'Add a copy-link button',
  requestedBy: 'Owner',
  at: '2026-11-23T10:00:00Z',
});

describe('job lifecycle', () => {
  it('starts in intake with no revisions', () => {
    expect(job.stage).toBe('intake');
    expect(job.revisions).toBe(0);
  });

  it('walks the happy path from intake to deployed', () => {
    let current = job;
    for (const stage of [
      'spec',
      'build',
      'qa',
      'review',
      'awaiting-approval',
      'merged',
      'deployed',
    ] as const) {
      current = transition(current, stage, '2026-11-23T11:00:00Z');
      expect(current.stage).toBe(stage);
    }
    expect(current.updatedAt).toBe('2026-11-23T11:00:00Z');
    expect(current.createdAt).toBe('2026-11-23T10:00:00Z');
  });

  it('counts going back to build from awaiting-approval as a revision', () => {
    const waiting = { ...job, stage: 'awaiting-approval' as const };
    expect(transition(waiting, 'build', 'now').revisions).toBe(1);
  });

  it('does not count QA or review sending work back as a revision', () => {
    const inQa = { ...job, stage: 'qa' as const };
    expect(transition(inQa, 'build', 'now').revisions).toBe(0);
  });

  it('refuses skipping straight to merged', () => {
    expect(canTransition('build', 'merged')).toBe(false);
    expect(() => transition({ ...job, stage: 'build' }, 'merged', 'now')).toThrow(
      InvalidTransitionError,
    );
  });

  it('records a job that ended outside the factory, from any unfinished stage', () => {
    expect(settle({ ...job, stage: 'build' }, 'merged', 'later')).toMatchObject({
      stage: 'merged',
      updatedAt: 'later',
    });
    expect(settle({ ...job, stage: 'blocked' }, 'cancelled', 'later').stage).toBe('cancelled');
    for (const stage of ['merged', 'deployed', 'cancelled'] as const) {
      expect(() => settle({ ...job, stage }, 'merged', 'later')).toThrow(InvalidTransitionError);
    }
  });

  it('never leaves cancelled', () => {
    expect(canTransition('cancelled', 'intake')).toBe(false);
  });

  it('does not mutate the original job', () => {
    transition(job, 'spec', 'now');
    expect(job.stage).toBe('intake');
  });
});
