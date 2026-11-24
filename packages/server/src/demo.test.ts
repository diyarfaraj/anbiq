import { afterEach, describe, expect, it } from 'vitest';
import { createDemo, type Demo } from './demo.js';
import type { Logger } from './log.js';

const errors: string[] = [];
const logger: Logger = { log: (level, message) => level === 'error' && errors.push(message) };

let demo: Demo | undefined;
afterEach(() => demo?.stop());

/** A seeded random, so the run is the same every time. */
function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1_103_515_245 + 12_345) % 2_147_483_648;
    return value / 2_147_483_648;
  };
}

describe('demo mode', () => {
  it('runs the real factory: jobs move through every stage, are merged and deployed', async () => {
    demo = createDemo({ logger, pace: 0.002, random: seeded(7) });
    demo.start();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && demo.events.countSince('deployed', '2000-01-01') < 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const kinds = new Set(demo.events.recent(1000).map((event) => event.kind));
    for (const kind of [
      'job.created',
      'run.started',
      'pr.opened',
      'approval.requested',
      'merged',
      'deployed',
    ]) {
      expect(kinds).toContain(kind);
    }
    expect(demo.store.listRecent(100).length).toBeGreaterThan(1);
    const usage = await demo.store.usage(new Date().toISOString());
    expect(usage.runningJobs).toBeLessThanOrEqual(demo.config.budgets.concurrent_jobs);
    expect(errors).toEqual([]);
  }, 15_000);

  it('stops cleanly', async () => {
    demo = createDemo({ logger, pace: 0.002, random: seeded(3) });
    demo.start();
    demo.stop();
    const before = demo.events.recent(1000).length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(demo.events.recent(1000).length).toBe(before);
  });
});
