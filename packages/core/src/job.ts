import type { Stage } from './stage.js';

export interface Job {
  id: string;
  project: string;
  title: string;
  stage: Stage;
  requestedBy: string;
  revisions: number;
  createdAt: string;
  updatedAt: string;
}

const TRANSITIONS: Record<Stage, readonly Stage[]> = {
  intake: ['spec', 'blocked', 'cancelled'],
  spec: ['build', 'blocked', 'cancelled'],
  build: ['qa', 'blocked', 'cancelled'],
  qa: ['review', 'build', 'blocked', 'cancelled'],
  review: ['awaiting-approval', 'build', 'blocked', 'cancelled'],
  'awaiting-approval': ['merged', 'build', 'cancelled'],
  merged: ['deployed'],
  deployed: ['deployed'],
  blocked: ['intake', 'spec', 'build', 'qa', 'review', 'cancelled'],
  cancelled: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: Stage,
    readonly to: Stage,
  ) {
    super(`a job cannot move from "${from}" to "${to}"`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function createJob(input: {
  id: string;
  project: string;
  title: string;
  requestedBy: string;
  at: string;
}): Job {
  return {
    id: input.id,
    project: input.project,
    title: input.title,
    stage: 'intake',
    requestedBy: input.requestedBy,
    revisions: 0,
    createdAt: input.at,
    updatedAt: input.at,
  };
}

const FINISHED: readonly Stage[] = ['merged', 'deployed', 'cancelled'];

/**
 * Records that a job ended outside the factory: a person merged its pull request, or closed it
 * or its issue, on the host. That is a fact to record and not a step the factory chose, so it
 * is not bound by the transitions above. A job that already finished stays as it is.
 */
export function settle(job: Job, to: 'merged' | 'cancelled', at: string): Job {
  if (FINISHED.includes(job.stage)) {
    throw new InvalidTransitionError(job.stage, to);
  }
  return { ...job, stage: to, updatedAt: at };
}

/** Returns the job in its new stage. Moving from awaiting-approval back to build counts as a revision. */
export function transition(job: Job, to: Stage, at: string): Job {
  if (!canTransition(job.stage, to)) {
    throw new InvalidTransitionError(job.stage, to);
  }
  const isRevision = job.stage === 'awaiting-approval' && to === 'build';
  return {
    ...job,
    stage: to,
    revisions: isRevision ? job.revisions + 1 : job.revisions,
    updatedAt: at,
  };
}
