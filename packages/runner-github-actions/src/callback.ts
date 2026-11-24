import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RunResult } from '@anbiq/core';
import { z } from 'zod';

/** Callbacks older than this are refused, so a captured one cannot be replayed later. */
const MAX_AGE_SECONDS = 10 * 60;
const SUMMARY_LIMIT = 8000;

/** The signature the workflow sends: HMAC-SHA256 over "<timestamp>.<body>". */
export function signCallback(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function verifyCallback(input: {
  secret: string;
  body: string;
  timestamp: string | undefined;
  signature: string | undefined;
  now?: Date;
}): boolean {
  const { secret, body, timestamp, signature } = input;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const age = Math.abs((input.now ?? new Date()).getTime() / 1000 - Number(timestamp));
  if (age > MAX_AGE_SECONDS) return false;
  const given = Buffer.from(signature);
  const wanted = Buffer.from(signCallback(secret, timestamp, body));
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

const resultSchema = z.object({
  runId: z.string().min(1),
  jobId: z.string().min(1),
  stage: z.enum(['spec', 'build', 'qa', 'review']),
  outcome: z.enum(['passed', 'failed', 'needs-input']),
  summary: z.string().trim().min(1),
  question: z.string().nullish(),
  headSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullish(),
  /** Null when the agent does not report what the run cost. */
  costUsd: z.number().min(0).nullish(),
});

export type CallbackResult = { ok: true; result: RunResult } | { ok: false; error: string };

/**
 * Parses a verified callback. The crew wrote part of it, so it is validated like any
 * untrusted input: known stages and outcomes only, and the summary length is capped.
 */
export function parseCallback(body: string, expectedRunId: string): CallbackResult {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, error: 'the callback body is not JSON' };
  }
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  const data = parsed.data;
  if (data.runId !== expectedRunId) {
    return { ok: false, error: 'the callback is for a different run' };
  }
  const summary =
    data.summary.length > SUMMARY_LIMIT
      ? `${data.summary.slice(0, SUMMARY_LIMIT - 1)}…`
      : data.summary;
  return {
    ok: true,
    result: {
      runId: data.runId,
      jobId: data.jobId,
      stage: data.stage,
      outcome: data.outcome,
      summary,
      ...(typeof data.costUsd === 'number' ? { costUsd: data.costUsd } : {}),
      ...(data.headSha ? { headSha: data.headSha } : {}),
      ...(data.outcome === 'needs-input' && data.question ? { question: data.question } : {}),
    },
  };
}
