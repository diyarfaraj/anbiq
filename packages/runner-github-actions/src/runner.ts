import type { RunRef, RunSpec, Runner } from '@anbiq/core';
import { GitHubClient, type RepositoryOptions } from '@anbiq/github';

export interface GitHubActionsRunnerOptions extends RepositoryOptions {
  /** The workflow file in the target repository, for example "anbiq-run.yml". */
  workflow: string;
  /** The branch the workflow definition is read from, normally the base branch. */
  ref: string;
}

/** GitHub limits the total size of workflow_dispatch inputs; stay safely under it. */
const MAX_INPUT_BYTES = 60_000;

/** The workflow's run-name, so a run can be found again by its Anbiq run ID. */
export const runName = (runId: string): string => `anbiq ${runId}`;

export class GitHubActionsRunner implements Runner {
  private readonly client: GitHubClient;

  constructor(private readonly options: GitHubActionsRunnerOptions) {
    this.client = new GitHubClient(options);
  }

  async start(spec: RunSpec): Promise<RunRef> {
    const invocation = Buffer.from(JSON.stringify(spec.invocation)).toString('base64');
    if (Buffer.byteLength(invocation) > MAX_INPUT_BYTES) {
      throw new Error(
        `the ${spec.stage} prompt for ${spec.jobId} is too large to dispatch (${Buffer.byteLength(invocation)} bytes)`,
      );
    }
    await this.client.repo(
      'POST',
      `/actions/workflows/${encodeURIComponent(this.options.workflow)}/dispatches`,
      {
        ref: this.options.ref,
        inputs: {
          run_id: spec.runId,
          job_id: spec.jobId,
          stage: spec.stage,
          branch: spec.branch,
          invocation,
        },
      },
    );
    const { owner, repo, workflow } = this.options;
    return {
      id: spec.runId,
      url: `https://github.com/${owner}/${repo}/actions/workflows/${workflow}`,
    };
  }

  async cancel(run: RunRef): Promise<void> {
    const { workflow_runs: runs } = await this.client.repo<{
      workflow_runs: { id: number; display_title: string; status: string }[];
    }>(
      'GET',
      `/actions/workflows/${encodeURIComponent(this.options.workflow)}/runs?event=workflow_dispatch&per_page=50`,
    );
    for (const candidate of runs) {
      if (candidate.display_title === runName(run.id) && candidate.status !== 'completed') {
        await this.client.repo('POST', `/actions/runs/${candidate.id}/cancel`);
      }
    }
  }
}
