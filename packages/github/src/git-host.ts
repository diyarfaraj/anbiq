import { HeadMovedError, type GitHost, type PullRequestRef } from '@anbiq/core';
import { GitHubClient, GitHubError, type RepositoryOptions } from './client.js';

export interface GitHubGitHostOptions extends RepositoryOptions {
  /** The branch pull requests target. */
  baseBranch: string;
}

interface PullRequest {
  number: number;
  html_url: string;
  head: { sha: string };
}

const PASSING = new Set(['success', 'neutral', 'skipped']);

export class GitHubGitHost implements GitHost {
  private readonly client: GitHubClient;

  constructor(private readonly options: GitHubGitHostOptions) {
    this.client = new GitHubClient(options);
  }

  async openPullRequest(input: {
    jobId: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<PullRequestRef> {
    const pr = await this.client.repo<PullRequest>('POST', '/pulls', {
      title: input.title,
      head: input.branch,
      base: this.options.baseBranch,
      body: `${input.body}\n\n<!-- anbiq:job ${input.jobId} -->`,
    });
    return { id: String(pr.number), url: pr.html_url };
  }

  /**
   * Checks pass only when at least one check or status exists for the head commit, none is
   * still running and none failed. A repository without any checks never counts as passing.
   */
  async pullRequestState(pr: PullRequestRef): Promise<{ checksPassed: boolean; headSha: string }> {
    const headSha = (await this.client.repo<PullRequest>('GET', `/pulls/${pr.id}`)).head.sha;
    const checks = await this.client.repo<{
      total_count: number;
      check_runs: { status: string; conclusion: string | null }[];
    }>('GET', `/commits/${headSha}/check-runs?per_page=100`);
    const statuses = await this.client.repo<{ state: string; total_count: number }>(
      'GET',
      `/commits/${headSha}/status`,
    );

    const checksGreen = checks.check_runs.every(
      (run) => run.status === 'completed' && run.conclusion !== null && PASSING.has(run.conclusion),
    );
    const statusesGreen = statuses.total_count === 0 || statuses.state === 'success';
    const anything = checks.total_count + statuses.total_count > 0;
    return { checksPassed: anything && checksGreen && statusesGreen, headSha };
  }

  /** Squash-merges, pinned to the reviewed commit: GitHub refuses if the head has moved. */
  async merge(pr: PullRequestRef, expectedHeadSha: string): Promise<void> {
    try {
      await this.client.repo('PUT', `/pulls/${pr.id}/merge`, {
        sha: expectedHeadSha,
        merge_method: 'squash',
      });
    } catch (error) {
      if (error instanceof GitHubError && error.status === 409) {
        const actual = (await this.client.repo<PullRequest>('GET', `/pulls/${pr.id}`)).head.sha;
        throw new HeadMovedError(expectedHeadSha, actual);
      }
      throw error;
    }
  }
}
