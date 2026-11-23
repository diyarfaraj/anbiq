import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HeadMovedError } from '@anbiq/core';
import { GitHubAppAuth, staticToken } from './auth.js';
import { GitHubGitHost } from './git-host.js';
import { GitHubTracker } from './tracker.js';
import { fakeGitHub } from './__fixtures__/github.js';

function adapters() {
  const github = fakeGitHub();
  const options = { owner: 'o', repo: 'r', auth: staticToken('t'), fetch: github.fetch };
  return {
    github,
    tracker: new GitHubTracker(options),
    gitHost: new GitHubGitHost({ ...options, baseBranch: 'main' }),
  };
}

describe('GitHubTracker', () => {
  it('creates jobs as issues labelled anbiq, with a hidden job marker', async () => {
    const { github, tracker } = adapters();
    const issue = await tracker.createJob({
      jobId: 'acme-1',
      title: 'Add a button',
      body: 'Please.',
    });
    const stored = github.issues.get(Number(issue.id))!;
    expect(stored.labels).toEqual(['anbiq']);
    expect(stored.body).toContain('<!-- anbiq:job acme-1 -->');
  });

  it("moves the stage label and keeps people's own labels", async () => {
    const { github, tracker } = adapters();
    const issue = await tracker.createJob({ jobId: 'acme-1', title: 't', body: 'b' });
    github.issues.get(Number(issue.id))!.labels.push('frontend');
    await tracker.setStage(issue, 'build');
    await tracker.setStage(issue, 'qa');
    expect(github.issues.get(Number(issue.id))!.labels.sort()).toEqual([
      'anbiq',
      'anbiq:stage:qa',
      'frontend',
    ]);
  });

  it('lets the earliest claim win when two runs claim at the same moment', async () => {
    const { github, tracker } = adapters();
    const issue = await tracker.createJob({ jobId: 'acme-1', title: 't', body: 'b' });
    // Simulate a race: run-2's claim comment lands first, before run-1 posts its own.
    github.comments.set(1, {
      id: 1,
      issue: Number(issue.id),
      body: '<!-- anbiq:claim run=run-2 -->',
    });
    expect(await tracker.claim(issue, 'run-1')).toBe(false);
    expect(await tracker.claim(issue, 'run-2')).toBe(true);
  });

  it('keeps an audit trail: released claims stay as comments', async () => {
    const { github, tracker } = adapters();
    const issue = await tracker.createJob({ jobId: 'acme-1', title: 't', body: 'b' });
    await tracker.claim(issue, 'run-1');
    await tracker.release(issue, 'run-1');
    const bodies = [...github.comments.values()].map((c) => c.body);
    expect(bodies).toEqual([expect.stringContaining('anbiq:released run=run-1')]);
  });

  it('reads claims beyond the first page of comments', async () => {
    const { github, tracker } = adapters();
    const issue = await tracker.createJob({ jobId: 'acme-1', title: 't', body: 'b' });
    for (let i = 0; i < 150; i++) {
      github.comments.set(i + 1, { id: i + 1, issue: Number(issue.id), body: `comment ${i}` });
    }
    github.comments.set(151, {
      id: 151,
      issue: Number(issue.id),
      body: '<!-- anbiq:claim run=run-9 -->',
    });
    expect(await tracker.claim(issue, 'run-1')).toBe(false);
  });
});

describe('GitHubGitHost', () => {
  it('opens the pull request from the job branch into the base branch', async () => {
    const { github, gitHost } = adapters();
    const pr = await gitHost.openPullRequest({
      jobId: 'acme-1',
      branch: 'anbiq/abc',
      title: 'Add a button',
      body: 'Closes #1',
    });
    expect(github.pulls.get(Number(pr.id))).toMatchObject({ head: 'anbiq/abc', base: 'main' });
  });

  it('counts checks as passed only when some exist and all succeeded', async () => {
    const { github, gitHost } = adapters();
    const pr = await gitHost.openPullRequest({
      jobId: 'acme-1',
      branch: 'b',
      title: 't',
      body: '',
    });
    github.push(Number(pr.id), 'sha-1');

    expect((await gitHost.pullRequestState(pr)).checksPassed).toBe(false); // no checks at all

    github.setChecks('sha-1', [
      { status: 'completed', conclusion: 'success' },
      { status: 'in_progress', conclusion: null },
    ]);
    expect((await gitHost.pullRequestState(pr)).checksPassed).toBe(false); // still running

    github.setChecks('sha-1', [
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'skipped' },
    ]);
    expect((await gitHost.pullRequestState(pr)).checksPassed).toBe(true);

    github.setStatuses('sha-1', ['failure']);
    expect((await gitHost.pullRequestState(pr)).checksPassed).toBe(false); // a legacy status failed
  });

  it('pins the merge to the reviewed commit and reports where the head moved to', async () => {
    const { github, gitHost } = adapters();
    const pr = await gitHost.openPullRequest({
      jobId: 'acme-1',
      branch: 'b',
      title: 't',
      body: '',
    });
    github.push(Number(pr.id), 'sha-2');
    const error = await gitHost.merge(pr, 'sha-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HeadMovedError);
    expect(error).toMatchObject({ expected: 'sha-1', actual: 'sha-2' });
  });

  it('squash-merges', async () => {
    const { github, gitHost } = adapters();
    const pr = await gitHost.openPullRequest({
      jobId: 'acme-1',
      branch: 'b',
      title: 't',
      body: '',
    });
    github.push(Number(pr.id), 'sha-1');
    await gitHost.merge(pr, 'sha-1');
    expect(github.pulls.get(Number(pr.id))?.merged).toBe(true);
  });
});

describe('GitHubAppAuth', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const now = new Date('2026-11-24T09:00:00Z');

  it('signs a short-lived app JWT with the private key', () => {
    const auth = new GitHubAppAuth({
      appId: '123',
      privateKey: pem,
      installationId: '9',
      now: () => now,
    });
    const [header, payload, signature] = auth.appJwt().split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<
      string,
      number | string
    >;
    expect(claims.iss).toBe('123');
    expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(600);
    const valid = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature!, 'base64url'));
    expect(valid).toBe(true);
  });

  it('exchanges the JWT for an installation token and reuses it until close to expiry', async () => {
    const github = fakeGitHub();
    let clock = now;
    const auth = new GitHubAppAuth({
      appId: '123',
      privateKey: pem,
      installationId: '9',
      fetch: github.fetch,
      now: () => clock,
    });

    expect(await auth.token()).toBe('ghs_installation_9');
    await auth.token();
    expect(github.requests.filter((r) => r.path.endsWith('/access_tokens'))).toHaveLength(1);

    clock = new Date('2026-11-24T09:56:00Z'); // within five minutes of expiry
    await auth.token();
    expect(github.requests.filter((r) => r.path.endsWith('/access_tokens'))).toHaveLength(2);
  });
});
