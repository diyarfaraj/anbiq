import type { AnbiqConfig } from './config.js';
import type { Usage } from './budget.js';
import type { Job } from './job.js';
import type { Stage } from './stage.js';

/** The stages a crew works. The other stages are decided by people or by the core. */
export type CrewStage = 'spec' | 'build' | 'qa' | 'review';

// ── Taps ────────────────────────────────────────────────────────────────

/** Where a conversation lives on a tap. Taps without threads use one thread per job. */
export interface ThreadRef {
  tap: string;
  channel: string;
  thread: string;
}

export interface InboundHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface HttpResponse {
  status: number;
  body?: string;
  contentType?: string;
}

export interface InboundMessage {
  tap: string;
  /** Unique per user message on the tap. Platforms that deliver a message twice give both deliveries the same ID. */
  messageId: string;
  /** The platform's stable user ID. Never a display name. */
  userId: string;
  thread: ThreadRef;
  text: string;
  receivedAt: string;
}

/** A tap-neutral message. Each tap renders it as well as the platform allows. */
export interface OutboundMessage {
  title: string;
  body?: string;
  fields?: { label: string; value: string }[];
  links?: { label: string; url: string }[];
  /** Suggested replies. Taps without buttons show them as text commands. */
  actions?: { label: string; command: string }[];
}

export interface TapCapabilities {
  threads: boolean;
  actions: boolean;
  editMessages: boolean;
  maxLength: number;
  replyWindowHours?: number;
}

export interface Tap {
  readonly id: string;
  readonly capabilities: TapCapabilities;
  /** Checks the platform's signature. Unsigned or tampered requests return false. */
  verify(request: InboundHttpRequest): Promise<boolean>;
  /** Returns null for platform events that are not user messages. */
  parse(request: InboundHttpRequest): Promise<InboundMessage | null>;
  send(thread: ThreadRef, message: OutboundMessage): Promise<void>;
  /**
   * Answers a verified platform handshake, such as a webhook URL challenge.
   * Returns null when the request is not a handshake.
   */
  handshake?(request: InboundHttpRequest): Promise<HttpResponse | null>;
  /** The response the platform expects after a handled webhook. Defaults to an empty 200. */
  readonly acknowledgement?: HttpResponse;
}

// ── Tracker and git host ────────────────────────────────────────────────

export interface IssueRef {
  id: string;
  url: string;
}

export interface Tracker {
  createJob(input: { jobId: string; title: string; body: string }): Promise<IssueRef>;
  comment(issue: IssueRef, body: string): Promise<void>;
  setStage(issue: IssueRef, stage: Stage): Promise<void>;
  /** Marks the job as taken by one run. Returns false if another run holds it. */
  claim(issue: IssueRef, runId: string): Promise<boolean>;
  release(issue: IssueRef, runId: string): Promise<void>;
}

export interface PullRequestRef {
  id: string;
  url: string;
}

export interface GitHost {
  openPullRequest(input: {
    jobId: string;
    branch: string;
    title: string;
    body: string;
  }): Promise<PullRequestRef>;
  pullRequestState(pr: PullRequestRef): Promise<{ checksPassed: boolean; headSha: string }>;
  /** Merges only if the head is still `expectedHeadSha`; throws HeadMovedError otherwise. */
  merge(pr: PullRequestRef, expectedHeadSha: string): Promise<void>;
}

export class HeadMovedError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`the pull request head moved from ${expected} to ${actual}`);
    this.name = 'HeadMovedError';
  }
}

export interface Deployer {
  deploy(input: {
    jobId: string;
    environment: string;
    pullRequest: PullRequestRef;
  }): Promise<{ url?: string }>;
}

// ── Runner and agent engine ─────────────────────────────────────────────

export interface EngineInvocation {
  engine: string;
  prompt: string;
  allowedTools: string[];
  maxTurns: number;
  timeoutMinutes: number;
  model?: string;
}

export interface AgentEngine {
  readonly id: string;
  prepare(input: {
    stage: CrewStage;
    request: string;
    feedback?: string;
    config: AnbiqConfig;
  }): EngineInvocation;
}

export interface RunSpec {
  runId: string;
  jobId: string;
  stage: CrewStage;
  branch: string;
  invocation: EngineInvocation;
}

export interface RunRef {
  id: string;
  url?: string;
}

export interface Runner {
  start(spec: RunSpec): Promise<RunRef>;
  cancel(run: RunRef): Promise<void>;
}

/** What a runner reports when a run ends. */
export interface RunResult {
  runId: string;
  jobId: string;
  stage: CrewStage;
  outcome: 'passed' | 'failed' | 'needs-input';
  summary: string;
  costUsd: number;
  /** The commit the run left the branch at (build, qa, review). */
  headSha?: string;
  /** For needs-input: what the crew wants to know. */
  question?: string;
}

// ── Storage and events ──────────────────────────────────────────────────

export interface JobRecord extends Job {
  request: string;
  thread: ThreadRef;
  branch: string;
  issue?: IssueRef;
  pullRequest?: PullRequestRef;
  reviewedSha?: string;
  activeRun?: RunRef & { stage: CrewStage };
  /** A stage waiting for a free slot. */
  queued?: { stage: CrewStage; feedback?: string };
  /** The last feedback given (revise text or an answer to a question). */
  feedback?: string;
  /** A command waiting for the person's second confirmation. */
  pendingConfirmation?: string;
  /** How many times QA or review sent the work back to build. */
  bounces: number;
  /** The crew stage to resume when a blocked job gets an answer. */
  resumeStage?: CrewStage;
}

export interface JobStore {
  get(id: string): Promise<JobRecord | undefined>;
  save(job: JobRecord): Promise<void>;
  findByThread(thread: ThreadRef): Promise<JobRecord | undefined>;
  listQueued(): Promise<JobRecord[]>;
  recordCost(jobId: string, usd: number, at: string): Promise<void>;
  /** Spend and job counts for the UTC day containing `at`, and jobs running now. */
  usage(at: string): Promise<Usage>;
  /** Records a delivered message. Returns false if the same key was recorded before. */
  claimMessage(key: string): Promise<boolean>;
}

export type FactoryEventKind =
  | 'request.received'
  | 'request.rejected'
  | 'job.created'
  | 'stage.entered'
  | 'run.started'
  | 'run.finished'
  | 'pr.opened'
  | 'approval.requested'
  | 'approval.given'
  | 'approval.rejected'
  | 'merged'
  | 'deployed'
  | 'budget.exceeded';

/** Metadata only: never source code, secrets or full logs. */
export interface FactoryEvent {
  v: 1;
  id: string;
  at: string;
  project: string;
  kind: FactoryEventKind;
  job?: string;
  stage?: Stage;
  actor:
    | { type: 'person'; name: string }
    | { type: 'crew'; role: CrewStage; run: string }
    | { type: 'system' };
  summary: string;
  links?: { issue?: string; pr?: string; run?: string };
  costUsd?: number;
}

export interface EventSink {
  emit(event: FactoryEvent): Promise<void>;
}
