import type { IssueRef, Stage, Tracker } from '@anbiq/core';
import { GitHubClient, type RepositoryOptions } from './client.js';

const JOB_LABEL = 'anbiq';
const STAGE_PREFIX = 'anbiq:stage:';
const CLAIM = /<!-- anbiq:claim run=(\S+) -->/;

interface Comment {
  id: number;
  body?: string;
}

/**
 * GitHub Issues as the tracker. Each job is an issue labelled "anbiq", its stage is an
 * "anbiq:stage:<stage>" label, and the people's own labels are left alone.
 */
export class GitHubTracker implements Tracker {
  private readonly client: GitHubClient;

  constructor(options: RepositoryOptions) {
    this.client = new GitHubClient(options);
  }

  async createJob(input: { jobId: string; title: string; body: string }): Promise<IssueRef> {
    const issue = await this.client.repo<{ number: number; html_url: string }>('POST', '/issues', {
      title: input.title,
      body: `${input.body}\n\n<!-- anbiq:job ${input.jobId} -->`,
      labels: [JOB_LABEL],
    });
    return { id: String(issue.number), url: issue.html_url };
  }

  async comment(issue: IssueRef, body: string): Promise<void> {
    await this.client.repo('POST', `/issues/${issue.id}/comments`, { body });
  }

  async setStage(issue: IssueRef, stage: Stage): Promise<void> {
    const current = await this.client.repo<{ name: string }[]>('GET', `/issues/${issue.id}/labels`);
    const kept = current
      .map((label) => label.name)
      .filter((name) => !name.startsWith(STAGE_PREFIX));
    const labels = [...new Set([...kept, JOB_LABEL, `${STAGE_PREFIX}${stage}`])];
    await this.client.repo('PUT', `/issues/${issue.id}/labels`, { labels });
  }

  /**
   * GitHub has no lock primitive, so a claim is a marked comment. Comment IDs are totally
   * ordered: when two runs claim at once, both see the same earliest claim, and only its
   * owner proceeds. The loser withdraws its comment.
   */
  async claim(issue: IssueRef, runId: string): Promise<boolean> {
    const holder = await this.earliestClaim(issue);
    if (holder) return holder.runId === runId;

    const posted = await this.client.repo<Comment>('POST', `/issues/${issue.id}/comments`, {
      body: `<!-- anbiq:claim run=${runId} -->\nA crew is working on this job (run \`${runId}\`).`,
    });
    const winner = await this.earliestClaim(issue);
    if (winner?.commentId === posted.id) return true;
    await this.markReleased(posted.id, runId);
    return false;
  }

  async release(issue: IssueRef, runId: string): Promise<void> {
    for (const claim of await this.activeClaims(issue)) {
      if (claim.runId === runId) await this.markReleased(claim.commentId, runId);
    }
  }

  private async earliestClaim(issue: IssueRef) {
    const claims = await this.activeClaims(issue);
    return claims.sort((a, b) => a.commentId - b.commentId)[0];
  }

  private async activeClaims(issue: IssueRef): Promise<{ commentId: number; runId: string }[]> {
    const comments = await this.client.repoList<Comment>(`/issues/${issue.id}/comments`);
    return comments.flatMap((comment) => {
      const match = CLAIM.exec(comment.body ?? '');
      return match?.[1] ? [{ commentId: comment.id, runId: match[1] }] : [];
    });
  }

  private async markReleased(commentId: number, runId: string): Promise<void> {
    await this.client.repo('PATCH', `/issues/comments/${commentId}`, {
      body: `<!-- anbiq:released run=${runId} -->\nRun \`${runId}\` finished.`,
    });
  }
}
