import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { OPENCODE_VERSION } from '@anbiq/engine-opencode';
import { staticToken } from '@anbiq/github';
import { describeRunnerConformance } from '@anbiq/testkit';
import { parseCallback, signCallback, verifyCallback } from './callback.js';
import { GitHubActionsRunner, runName } from './runner.js';

function fakeActions() {
  const dispatches: { workflow: string; body: { ref: string; inputs: Record<string, string> } }[] =
    [];
  const runs: { id: number; display_title: string; status: string }[] = [];
  const cancelled: number[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    let m: RegExpExecArray | null;
    if (
      method === 'POST' &&
      (m = /\/actions\/workflows\/([^/]+)\/dispatches$/.exec(url.pathname))
    ) {
      const body = JSON.parse(String(init?.body)) as {
        ref: string;
        inputs: Record<string, string>;
      };
      dispatches.push({ workflow: decodeURIComponent(m[1]!), body });
      runs.push({
        id: runs.length + 1,
        display_title: runName(body.inputs.run_id!),
        status: 'in_progress',
      });
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && /\/actions\/workflows\/[^/]+\/runs$/.test(url.pathname)) {
      return new Response(JSON.stringify({ workflow_runs: runs }), { status: 200 });
    }
    if (method === 'POST' && (m = /\/actions\/runs\/(\d+)\/cancel$/.exec(url.pathname))) {
      cancelled.push(Number(m[1]));
      return new Response(null, { status: 202 });
    }
    return new Response(JSON.stringify({ message: 'no route' }), { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, dispatches, runs, cancelled };
}

function runnerWith(actions = fakeActions()) {
  const runner = new GitHubActionsRunner({
    owner: 'o',
    repo: 'r',
    auth: staticToken('t'),
    fetch: actions.fetch,
    workflow: 'anbiq-run.yml',
    ref: 'main',
  });
  return { runner, actions };
}

const spec = {
  runId: 'run-1',
  jobId: 'acme-1',
  stage: 'build' as const,
  branch: 'anbiq/abc',
  invocation: {
    engine: 'claude-code',
    prompt: 'Build it',
    settings: {},
    maxTurns: 5,
    timeoutMinutes: 5,
  },
};

describeRunnerConformance('GitHubActionsRunner', () => runnerWith().runner);

describe('GitHubActionsRunner', () => {
  it('dispatches the workflow from the base branch with the run and an encoded invocation', async () => {
    const { runner, actions } = runnerWith();
    await runner.start(spec);
    const dispatch = actions.dispatches[0]!;
    expect(dispatch.workflow).toBe('anbiq-run.yml');
    expect(dispatch.body.ref).toBe('main');
    expect(dispatch.body.inputs).toMatchObject({
      run_id: 'run-1',
      job_id: 'acme-1',
      stage: 'build',
      branch: 'anbiq/abc',
    });
    const decoded = JSON.parse(
      Buffer.from(dispatch.body.inputs.invocation!, 'base64').toString(),
    ) as { prompt: string };
    expect(decoded.prompt).toBe('Build it');
  });

  it('refuses a prompt too large for GitHub to dispatch', async () => {
    const { runner } = runnerWith();
    const huge = { ...spec, invocation: { ...spec.invocation, prompt: 'x'.repeat(80_000) } };
    await expect(runner.start(huge)).rejects.toThrow(/too large/);
  });

  it('cancels the workflow run that carries the Anbiq run ID, and only that one', async () => {
    const { runner, actions } = runnerWith();
    await runner.start(spec);
    await runner.start({ ...spec, runId: 'run-2' });
    await runner.cancel({ id: 'run-2' });
    expect(actions.cancelled).toEqual([2]);
  });
});

describe('callbacks', () => {
  const secret = 'callback-secret';
  const now = new Date('2026-11-24T09:00:00Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const sha = 'a'.repeat(40);
  const body = JSON.stringify({
    runId: 'run-1',
    jobId: 'acme-1',
    stage: 'review',
    outcome: 'passed',
    summary: 'Ready to merge',
    question: null,
    headSha: sha,
    costUsd: 0.42,
  });

  it('accepts a correctly signed, recent callback', () => {
    const signature = signCallback(secret, timestamp, body);
    expect(verifyCallback({ secret, body, timestamp, signature, now })).toBe(true);
  });

  it('rejects a tampered body, a wrong secret and an old timestamp', () => {
    const signature = signCallback(secret, timestamp, body);
    expect(
      verifyCallback({ secret, body: body.replace('passed', 'failed'), timestamp, signature, now }),
    ).toBe(false);
    expect(verifyCallback({ secret: 'other', body, timestamp, signature, now })).toBe(false);
    const old = String(Number(timestamp) - 3600);
    expect(
      verifyCallback({
        secret,
        body,
        timestamp: old,
        signature: signCallback(secret, old, body),
        now,
      }),
    ).toBe(false);
  });

  it('parses a callback into a run result', () => {
    const parsed = parseCallback(body, 'run-1');
    expect(parsed).toEqual({
      ok: true,
      result: {
        runId: 'run-1',
        jobId: 'acme-1',
        stage: 'review',
        outcome: 'passed',
        summary: 'Ready to merge',
        costUsd: 0.42,
        headSha: sha,
      },
    });
  });

  it('refuses a callback for a different run, an unknown outcome or a malformed commit', () => {
    expect(parseCallback(body, 'run-2').ok).toBe(false);
    expect(parseCallback(body.replace('"passed"', '"merged"'), 'run-1').ok).toBe(false);
    expect(parseCallback(body.replace(sha, 'not-a-sha'), 'run-1').ok).toBe(false);
  });

  it('caps a very long summary from the crew', () => {
    const long = JSON.stringify({ ...JSON.parse(body), summary: 'x'.repeat(20_000) });
    const parsed = parseCallback(long, 'run-1');
    expect(parsed.ok && parsed.result.summary.length).toBe(8000);
  });
});

describe('a callback from an engine that reports no cost', () => {
  const body = (costUsd?: unknown) =>
    JSON.stringify({
      runId: 'run-1',
      jobId: 'acme-1',
      stage: 'build',
      outcome: 'passed',
      summary: 'Done',
      ...(costUsd === undefined ? {} : { costUsd }),
    });

  it('leaves the cost out rather than reporting it as zero', () => {
    for (const sent of [body(), body(null)]) {
      const parsed = parseCallback(sent, 'run-1');
      expect(parsed.ok && 'costUsd' in parsed.result).toBe(false);
    }
  });

  it('keeps a reported cost, including zero', () => {
    const parsed = parseCallback(body(0), 'run-1');
    expect(parsed.ok && parsed.result.costUsd).toBe(0);
  });
});

describe('workflow template', () => {
  const source = readFileSync(new URL('../templates/anbiq-run.yml', import.meta.url), 'utf8');
  const workflow = parseYaml(source) as {
    permissions: Record<string, string>;
    jobs: Record<
      string,
      {
        permissions: Record<string, string>;
        steps: {
          name?: string;
          run?: string;
          env?: Record<string, string>;
          uses?: string;
          if?: string;
          with?: Record<string, string>;
        }[];
      }
    >;
  };

  it('never interpolates inputs or step outputs into shell scripts', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        expect(step.run ?? '').not.toMatch(/\$\{\{/);
      }
    }
  });

  it('runs the agent with a read-only token and no factory secrets', () => {
    const crew = workflow.jobs.crew!;
    expect(crew.permissions).toEqual({ contents: 'read' });
    expect(JSON.stringify(crew)).not.toContain('ANBIQ_CALLBACK_SECRET');
  });

  it('keeps write access and the callback secret in a job that runs no agent', () => {
    const publish = workflow.jobs.publish!;
    expect(publish.permissions).toEqual({ contents: 'write' });
    expect(publish.steps.some((step) => step.uses?.startsWith('anthropics/'))).toBe(false);
  });

  it('runs each agent only for its own engine, and refuses an engine it has no step for', () => {
    const steps = workflow.jobs.crew!.steps;
    const agents = steps.filter((step) => /^Run the crew/.test(step.name ?? ''));
    const engines = agents.map((step) => /^Run the crew \((.+)\)$/.exec(step.name ?? '')?.[1]);
    expect(engines).toEqual(['claude-code', 'opencode']);
    for (const [index, step] of agents.entries()) {
      expect(step.if).toBe(`steps.prepare.outputs.engine == '${engines[index]}'`);
    }
    const refusal = steps.find((step) => /^Refuse an engine/.test(step.name ?? ''))!;
    expect(refusal.if).toContain(JSON.stringify(engines));
    expect(refusal.run).toContain('exit 1');
  });

  it('starts OpenCode with only the factory rules, and without approving what they leave open', () => {
    const step = workflow.jobs.crew!.steps.find((s) => s.name === 'Run the crew (opencode)')!;
    expect(step.env).toMatchObject({ OPENCODE_DISABLE_PROJECT_CONFIG: '1' });
    expect(step.run).toContain('export OPENCODE_CONFIG="$RUNNER_TEMP/opencode.json"');
    expect(step.run).toContain(`@opencode/cli@${OPENCODE_VERSION}`);
    const commands = step.run!.split('\n').filter((line) => !line.trim().startsWith('#'));
    expect(commands.join('\n')).not.toMatch(/--auto\b/);
    expect(step.run).toContain('< /dev/null');
  });

  it('discards commits that change CI workflows, whatever the engine allowed', () => {
    const step = workflow.jobs.crew!.steps.find((s) => s.name === 'Package the result')!;
    const guard = step.run!.indexOf('-- .github/workflows');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(step.run!.indexOf('git bundle create'));
  });

  it('starts from no permissions at the workflow level', () => {
    expect(workflow.permissions).toEqual({});
  });
});
