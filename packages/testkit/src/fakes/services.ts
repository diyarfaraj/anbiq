import {
  HeadMovedError,
  MergeRefusedError,
  type AgentEngine,
  type ChangedFile,
  type CrewStage,
  type Deployer,
  type EngineInvocation,
  type EventSink,
  type FactoryEvent,
  type GitHost,
  type IssueRef,
  type JobRecord,
  type JobStore,
  type PullRequestRef,
  type RunRef,
  type RunSpec,
  type Runner,
  type Stage,
  type ThreadRef,
  type Tracker,
  type Usage,
} from '@anbiq/core';

export class FakeTracker implements Tracker {
  readonly issues = new Map<
    string,
    { jobId: string; title: string; body: string; stage?: Stage; comments: string[] }
  >();
  private readonly claims = new Map<string, string>();
  private readonly closed = new Set<string>();

  async createJob(input: { jobId: string; title: string; body: string }): Promise<IssueRef> {
    const id = String(this.issues.size + 1);
    this.issues.set(id, { ...input, comments: [] });
    return { id, url: `https://tracker.test/issues/${id}` };
  }

  async comment(issue: IssueRef, body: string): Promise<void> {
    this.issue(issue).comments.push(body);
  }

  async setStage(issue: IssueRef, stage: Stage): Promise<void> {
    this.issue(issue).stage = stage;
  }

  async claim(issue: IssueRef, runId: string): Promise<boolean> {
    const holder = this.claims.get(issue.id);
    if (holder !== undefined && holder !== runId) return false;
    this.claims.set(issue.id, runId);
    return true;
  }

  async release(issue: IssueRef, runId: string): Promise<void> {
    if (this.claims.get(issue.id) === runId) this.claims.delete(issue.id);
  }

  async isOpen(issue: IssueRef): Promise<boolean> {
    this.issue(issue);
    return !this.closed.has(issue.id);
  }

  /** Simulates a person closing the issue on the tracker. */
  close(issueId: string): void {
    this.closed.add(issueId);
  }

  private issue(ref: IssueRef) {
    const issue = this.issues.get(ref.id);
    if (!issue) throw new Error(`unknown issue ${ref.id}`);
    return issue;
  }
}

export class FakeGitHost implements GitHost {
  readonly pullRequests = new Map<
    string,
    {
      branch: string;
      checksPassed: boolean;
      headSha: string;
      merged: boolean;
      closed: boolean;
      refusal?: string;
      files: ChangedFile[] | Error;
    }
  >();

  async openPullRequest(input: {
    jobId: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<PullRequestRef> {
    const id = String(this.pullRequests.size + 1);
    this.pullRequests.set(id, {
      branch: input.branch,
      checksPassed: false,
      headSha: 'initial',
      merged: false,
      closed: false,
      files: [],
    });
    return { id, url: `https://git.test/pulls/${id}` };
  }

  async pullRequestState(pr: PullRequestRef): Promise<{
    checksPassed: boolean;
    headSha: string;
    status: 'open' | 'merged' | 'closed';
  }> {
    const state = this.pr(pr.id);
    return {
      checksPassed: state.checksPassed,
      headSha: state.headSha,
      status: state.merged ? 'merged' : state.closed ? 'closed' : 'open',
    };
  }

  async merge(pr: PullRequestRef, expectedHeadSha: string): Promise<void> {
    const state = this.pr(pr.id);
    if (state.headSha !== expectedHeadSha) throw new HeadMovedError(expectedHeadSha, state.headSha);
    if (state.refusal !== undefined) throw new MergeRefusedError(state.refusal);
    state.merged = true;
  }

  async changedFiles(pr: PullRequestRef): Promise<ChangedFile[]> {
    const { files } = this.pr(pr.id);
    if (files instanceof Error) throw files;
    return structuredClone(files);
  }

  /** What the pull request changes against its base, or an error to answer with. */
  setFiles(prId: string, files: ChangedFile[] | Error): void {
    this.pr(prId).files = files;
  }

  /** Simulates a branch rule that stops the merge, such as a required review. */
  refuse(prId: string, reason: string | undefined): void {
    const state = this.pr(prId);
    if (reason === undefined) delete state.refusal;
    else state.refusal = reason;
  }

  /** Simulates a person merging or closing the pull request on the git host. */
  finishOutside(prId: string, how: 'merged' | 'closed'): void {
    const state = this.pr(prId);
    if (how === 'merged') state.merged = true;
    else state.closed = true;
  }

  /** Simulates a push to the pull request's branch and the checks that follow. */
  push(prId: string, headSha: string, checksPassed = true): void {
    const state = this.pr(prId);
    state.headSha = headSha;
    state.checksPassed = checksPassed;
  }

  private pr(id: string) {
    const state = this.pullRequests.get(id);
    if (!state) throw new Error(`unknown pull request ${id}`);
    return state;
  }
}

export class FakeRunner implements Runner {
  readonly started: RunSpec[] = [];
  readonly cancelled: string[] = [];

  async start(spec: RunSpec): Promise<RunRef> {
    this.started.push(spec);
    return { id: spec.runId, url: `https://runner.test/runs/${spec.runId}` };
  }

  async cancel(run: RunRef): Promise<void> {
    this.cancelled.push(run.id);
  }

  /** The most recently started run, which the tests then finish. */
  last(): RunSpec {
    const spec = this.started.at(-1);
    if (!spec) throw new Error('no run has started');
    return spec;
  }
}

export class FakeEngine implements AgentEngine {
  readonly id = 'fake-engine';

  prepare(input: {
    stage: CrewStage;
    request: string;
    spec?: string;
    feedback?: string;
  }): EngineInvocation {
    const spec = input.spec ? `\nSpec: ${input.spec}` : '';
    const feedback = input.feedback ? `\nFeedback: ${input.feedback}` : '';
    return {
      engine: this.id,
      prompt: `[${input.stage}] ${input.request}${spec}${feedback}`,
      allowedTools: ['read', 'edit', 'test'],
      maxTurns: 10,
      timeoutMinutes: 10,
    };
  }
}

export class FakeDeployer implements Deployer {
  readonly deployments: { jobId: string; environment: string }[] = [];

  async deploy(input: {
    jobId: string;
    environment: string;
    pullRequest: PullRequestRef;
  }): Promise<{ url?: string }> {
    this.deployments.push({ jobId: input.jobId, environment: input.environment });
    return { url: `https://${input.environment}.test` };
  }
}

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly costs: { jobId: string; usd: number; at: string }[] = [];
  private readonly seenMessages = new Set<string>();

  async claimMessage(key: string): Promise<boolean> {
    if (this.seenMessages.has(key)) return false;
    this.seenMessages.add(key);
    return true;
  }

  async get(id: string): Promise<JobRecord | undefined> {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : undefined;
  }

  async save(job: JobRecord): Promise<void> {
    this.jobs.set(job.id, structuredClone(job));
  }

  async findByThread(thread: ThreadRef): Promise<JobRecord | undefined> {
    for (const job of this.jobs.values()) {
      if (sameThread(job.thread, thread)) return structuredClone(job);
    }
    return undefined;
  }

  async listQueued(): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.queued !== undefined)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .map((job) => structuredClone(job));
  }

  async listUnfinished(): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => !['merged', 'deployed', 'cancelled'].includes(job.stage))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((job) => structuredClone(job));
  }

  async recordCost(jobId: string, usd: number, at: string): Promise<void> {
    this.costs.push({ jobId, usd, at });
  }

  async usage(at: string): Promise<Usage> {
    const day = at.slice(0, 10);
    const jobs = [...this.jobs.values()];
    return {
      usdToday: this.costs
        .filter((cost) => cost.at.startsWith(day))
        .reduce((sum, cost) => sum + cost.usd, 0),
      jobsToday: jobs.filter((job) => job.createdAt.startsWith(day)).length,
      runningJobs: jobs.filter((job) => job.activeRun !== undefined).length,
    };
  }
}

export class MemoryEventSink implements EventSink {
  readonly events: FactoryEvent[] = [];

  async emit(event: FactoryEvent): Promise<void> {
    this.events.push(event);
  }

  kinds(): string[] {
    return this.events.map((event) => event.kind);
  }
}

function sameThread(a: ThreadRef, b: ThreadRef): boolean {
  return a.tap === b.tap && a.channel === b.channel && a.thread === b.thread;
}
