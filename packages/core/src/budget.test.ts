import { describe, expect, it } from 'vitest';
import { canAcceptJob, canStartRun } from './budget.js';

const budgets = { usd_per_day: 25, jobs_per_day: 10, concurrent_jobs: 1 };

describe('budgets', () => {
  it('accepts work while under every limit', () => {
    const usage = { usdToday: 3, jobsToday: 2, runningJobs: 0 };
    expect(canAcceptJob(usage, budgets)).toEqual({ ok: true });
    expect(canStartRun(usage, budgets)).toEqual({ ok: true });
  });

  it('stops new jobs at the daily job limit', () => {
    const result = canAcceptJob({ usdToday: 0, jobsToday: 10, runningJobs: 0 }, budgets);
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/10 jobs/) });
  });

  it('stops new jobs and runs once the daily spend is reached', () => {
    const spent = { usdToday: 25, jobsToday: 0, runningJobs: 0 };
    expect(canAcceptJob(spent, budgets).ok).toBe(false);
    expect(canStartRun(spent, budgets).ok).toBe(false);
  });

  it('counts only jobs when no daily spend is set, as for an engine that reports no cost', () => {
    const jobsOnly = { jobs_per_day: 10, concurrent_jobs: 1 };
    const spent = { usdToday: 900, jobsToday: 9, runningJobs: 0 };
    expect(canAcceptJob(spent, jobsOnly)).toEqual({ ok: true });
    expect(canStartRun(spent, jobsOnly)).toEqual({ ok: true });
    expect(canAcceptJob({ ...spent, jobsToday: 10 }, jobsOnly).ok).toBe(false);
  });

  it('queues runs beyond the concurrency limit without refusing the job', () => {
    const busy = { usdToday: 0, jobsToday: 1, runningJobs: 1 };
    expect(canAcceptJob(busy, budgets).ok).toBe(true);
    expect(canStartRun(busy, budgets)).toEqual({
      ok: false,
      reason: expect.stringMatching(/waits/),
    });
  });
});
