import type { AnbiqConfig } from './config.js';

export interface Usage {
  usdToday: number;
  jobsToday: number;
  runningJobs: number;
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

type Budgets = AnbiqConfig['budgets'];

/** Whether a new request may become a job today. */
export function canAcceptJob(usage: Usage, budgets: Budgets): BudgetCheck {
  if (usage.jobsToday >= budgets.jobs_per_day) {
    return { ok: false, reason: `the daily limit of ${budgets.jobs_per_day} jobs is reached` };
  }
  return spendLeft(usage, budgets);
}

/** Whether a run may start now. A run that cannot start waits in the queue. */
export function canStartRun(usage: Usage, budgets: Budgets): BudgetCheck {
  if (usage.runningJobs >= budgets.concurrent_jobs) {
    return {
      ok: false,
      reason: `${budgets.concurrent_jobs} job(s) already running; this one waits its turn`,
    };
  }
  return spendLeft(usage, budgets);
}

function spendLeft(usage: Usage, budgets: Budgets): BudgetCheck {
  if (budgets.usd_per_day !== undefined && usage.usdToday >= budgets.usd_per_day) {
    return { ok: false, reason: `the daily budget of $${budgets.usd_per_day} is spent` };
  }
  return { ok: true };
}
