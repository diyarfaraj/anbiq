import { canAcceptJob, canStartRun } from './budget.js';
import { commandText, parseCommand, type Command } from './command.js';
import type { AnbiqConfig } from './config.js';
import { fastLaneVerdict } from './fast-lane.js';
import { findPerson, hasRole, type Person } from './identity.js';
import { createJob, settle, transition } from './job.js';
import { decide, type PullRequestState } from './policy.js';
import {
  HeadMovedError,
  MergeRefusedError,
  type AgentEngine,
  type CrewStage,
  type Deployer,
  type EventSink,
  type FactoryEvent,
  type GitHost,
  type HttpResponse,
  type InboundHttpRequest,
  type InboundMessage,
  type JobRecord,
  type JobStore,
  type OutboundMessage,
  type RunResult,
  type Runner,
  type Tap,
  type ThreadRef,
  type Tracker,
} from './ports.js';
import type { Stage } from './stage.js';

export interface FactoryDeps {
  config: AnbiqConfig;
  taps: Tap[];
  tracker: Tracker;
  gitHost: GitHost;
  runner: Runner;
  engine: AgentEngine;
  store: JobStore;
  deployer?: Deployer;
  events?: EventSink[];
  now?: () => Date;
  newId?: () => string;
  /**
   * Schedules handling a verified message after the webhook is answered, since chat platforms
   * retry webhooks that take more than a few seconds. Without it, messages are handled before
   * answering.
   */
  defer?: (task: () => Promise<void>) => void;
}

export interface Factory {
  /** Verifies, parses and handles one request from a tap's webhook. */
  handleHttp(tapId: string, request: InboundHttpRequest): Promise<HttpResponse>;
  /** Handles a message that a tap has already verified and parsed. */
  handleMessage(message: InboundMessage): Promise<void>;
  /** Moves a job on when a runner reports that a run ended. */
  handleRunResult(result: RunResult): Promise<void>;
  /**
   * Finishes jobs whose pull request was merged or closed, or whose issue was closed, outside
   * the factory. Call it on a timer; it is also done for a job whenever a message arrives in
   * its thread.
   */
  reconcile(): Promise<void>;
}

const CONFIRM_WORDS = ['yes', 'confirm'];
const FINISHED: readonly Stage[] = ['merged', 'deployed', 'cancelled'];
const COMMAND_HELP =
  'Reply with revise: <feedback>, merge, deploy <environment>, status or cancel, or start a new thread for new work.';

type NewEvent = Omit<FactoryEvent, 'v' | 'id' | 'at' | 'project'>;

export function createFactory(deps: FactoryDeps): Factory {
  const { config, tracker, gitHost, runner, engine, store } = deps;
  const taps = new Map(deps.taps.map((tap) => [tap.id, tap]));
  const now = (): string => (deps.now ? deps.now() : new Date()).toISOString();
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function emit(event: NewEvent): Promise<void> {
    const full: FactoryEvent = { v: 1, id: newId(), at: now(), project: config.project, ...event };
    for (const sink of deps.events ?? []) {
      await sink.emit(full);
    }
  }

  async function reply(thread: ThreadRef, message: OutboundMessage): Promise<void> {
    await taps.get(thread.tap)?.send(thread, message);
  }

  async function moveTo(job: JobRecord, stage: Stage): Promise<JobRecord> {
    return entered({ ...job, ...transition(job, stage, now()) });
  }

  async function entered(moved: JobRecord): Promise<JobRecord> {
    const stage = moved.stage;
    if (moved.issue) await tracker.setStage(moved.issue, stage);
    await emit({
      kind: 'stage.entered',
      job: moved.id,
      stage,
      actor: { type: 'system' },
      summary: `entered ${stage}`,
    });
    return moved;
  }

  /** Starts a crew stage, or queues it when the concurrency or spend limit is reached. */
  async function startStage(job: JobRecord, stage: CrewStage, feedback?: string): Promise<boolean> {
    const budget = canStartRun(await store.usage(now()), config.budgets);
    if (!budget.ok) {
      await store.save({
        ...job,
        queued: feedback === undefined ? { stage } : { stage, feedback },
      });
      await emit({
        kind: 'budget.exceeded',
        job: job.id,
        actor: { type: 'system' },
        summary: budget.reason,
      });
      await reply(job.thread, { title: `${job.id} is queued`, body: budget.reason });
      return false;
    }

    let current: JobRecord = { ...job };
    delete current.queued;
    if (current.stage !== stage) current = await moveTo(current, stage);

    const runId = newId();
    if (current.issue && !(await tracker.claim(current.issue, runId))) {
      await reply(current.thread, { title: `Another run is already working on ${current.id}` });
      return false;
    }

    const invocation = engine.prepare({
      stage,
      request: current.request,
      config,
      ...(current.spec === undefined ? {} : { spec: current.spec }),
      ...(feedback === undefined ? {} : { feedback }),
    });
    const run = await runner.start({
      runId,
      jobId: current.id,
      stage,
      branch: current.branch,
      invocation,
    });
    current = { ...current, activeRun: { ...run, stage } };
    await store.save(current);
    await emit({
      kind: 'run.started',
      job: current.id,
      stage,
      actor: { type: 'crew', role: stage, run: run.id },
      summary: `${stage} crew started`,
      ...(run.url ? { links: { run: run.url } } : {}),
    });
    return true;
  }

  async function drainQueue(): Promise<void> {
    for (const job of await store.listQueued()) {
      if (!job.queued) continue;
      const started = await startStage(job, job.queued.stage, job.queued.feedback);
      if (!started) return;
    }
  }

  async function stopActiveRun(job: JobRecord): Promise<JobRecord> {
    if (!job.activeRun) return job;
    await runner.cancel(job.activeRun);
    if (job.issue) await tracker.release(job.issue, job.activeRun.id);
    const stopped = { ...job };
    delete stopped.activeRun;
    await store.save(stopped);
    return stopped;
  }

  async function handleHttp(tapId: string, request: InboundHttpRequest): Promise<HttpResponse> {
    const tap = taps.get(tapId);
    if (!tap) return { status: 404 };
    if (!(await tap.verify(request))) return { status: 401 };
    const handshake = await tap.handshake?.(request);
    if (handshake) return handshake;
    const message = await tap.parse(request);
    if (message) {
      if (deps.defer) deps.defer(() => handleMessage(message));
      else await handleMessage(message);
    }
    return tap.acknowledgement ?? { status: 200 };
  }

  async function handleMessage(message: InboundMessage): Promise<void> {
    // Platforms retry webhooks and can deliver one message as several events.
    if (!(await store.claimMessage(`${message.tap}:${message.messageId}`))) return;

    const person = findPerson(config, message.tap, message.userId);
    if (!person) {
      // Unknown senders get no reply, so the factory cannot be probed or spammed through it.
      await emit({
        kind: 'request.rejected',
        actor: { type: 'system' },
        summary: `message from an unknown ${message.tap} user`,
      });
      return;
    }

    try {
      await handleFrom(person, message);
    } catch (error) {
      // The person must not be left guessing. The error itself goes to the server log.
      await reply(message.thread, {
        title: 'Not done: something went wrong while handling that message',
        body: 'Nothing else will happen with it. The server log has the details.',
      }).catch(() => undefined);
      throw error;
    }
  }

  async function handleFrom(person: Person, message: InboundMessage): Promise<void> {
    const job = await store.findByThread(message.thread);
    // If the job was finished on the tracker or git host directly, say so and stop there.
    if (job && (await catchUp(job))) return;
    let text = message.text;
    let confirmed = false;
    if (job?.pendingConfirmation && CONFIRM_WORDS.includes(text.trim().toLowerCase())) {
      text = job.pendingConfirmation;
      confirmed = true;
    }

    const parsed = parseCommand(text);
    if (!parsed.ok) {
      await reply(message.thread, { title: parsed.error });
      return;
    }
    const command = parsed.command;

    if (command.type === 'request' && job) {
      if (job.stage === 'blocked' && job.resumeStage && !job.activeRun) {
        await answer(job, person, command.text);
        return;
      }
      await reply(message.thread, {
        title: `This thread belongs to ${job.id}`,
        body: COMMAND_HELP,
      });
      return;
    }

    await emit({
      kind: 'request.received',
      ...(job ? { job: job.id } : {}),
      actor: { type: 'person', name: person.name },
      summary: commandText(command),
    });

    let pullRequest: PullRequestState | undefined;
    if (command.type === 'merge' && job?.pullRequest) {
      const state = await gitHost.pullRequestState(job.pullRequest);
      pullRequest =
        job.reviewedSha === undefined ? state : { ...state, reviewedSha: job.reviewedSha };
    }

    const decision = decide(command, {
      config,
      person,
      confirmed,
      ...(job ? { job } : {}),
      ...(pullRequest ? { pullRequest } : {}),
    });

    if (decision.outcome === 'deny') {
      if (job && (command.type === 'merge' || command.type === 'deploy')) {
        await emit({
          kind: 'approval.rejected',
          job: job.id,
          actor: { type: 'person', name: person.name },
          summary: decision.reason,
        });
      }
      await reply(message.thread, { title: `Not done: ${decision.reason}` });
      return;
    }

    if (decision.outcome === 'confirm') {
      if (!job) {
        await reply(message.thread, {
          title: `Not done: ${decision.reason}, and there is no job to confirm it on`,
        });
        return;
      }
      await store.save({ ...job, pendingConfirmation: commandText(command) });
      await reply(message.thread, {
        title: `Reply "yes" to confirm: ${commandText(command)}`,
        actions: [{ label: 'Confirm', command: 'yes' }],
      });
      return;
    }

    const current = job ? clearConfirmation(job) : undefined;
    await execute(command, person, message.thread, current);
  }

  function clearConfirmation(job: JobRecord): JobRecord {
    const cleared = { ...job };
    delete cleared.pendingConfirmation;
    return cleared;
  }

  async function execute(
    command: Command,
    person: Person,
    thread: ThreadRef,
    job: JobRecord | undefined,
  ) {
    switch (command.type) {
      case 'request':
        return startJob(command.text, person, thread, command.quick === true);
      case 'status':
        return reply(thread, job ? statusOf(job) : await projectStatus());
      case 'revise':
        return revise(job!, person, command.text);
      case 'merge':
        return merge(job!, person);
      case 'deploy':
        return deploy(job!, person, command.environment);
      case 'cancel':
        return cancel(job!, person);
    }
  }

  async function startJob(
    request: string,
    person: Person,
    thread: ThreadRef,
    askedForQuick: boolean,
  ): Promise<void> {
    const budget = canAcceptJob(await store.usage(now()), config.budgets);
    if (!budget.ok) {
      await emit({ kind: 'budget.exceeded', actor: { type: 'system' }, summary: budget.reason });
      await reply(thread, { title: `Not started: ${budget.reason}` });
      return;
    }

    // The short pipeline is the project's choice to offer: without a fast lane, "quick:" is
    // an ordinary request.
    const quick = askedForQuick && config.policy.fast_lane !== undefined;
    const short = newId().replace(/-/g, '').slice(0, 8);
    const id = `${config.project}-${short}`;
    const title = titleOf(request);
    const base = createJob({
      id,
      project: config.project,
      title,
      requestedBy: person.name,
      at: now(),
    });
    const issue = await tracker.createJob({
      jobId: id,
      title,
      body: `Requested by ${person.name} via ${thread.tap}.\n\n${request}`,
    });
    const job: JobRecord = {
      ...base,
      request,
      thread,
      branch: `anbiq/${short}`,
      issue,
      bounces: 0,
      ...(quick ? { quick } : {}),
    };
    await store.save(job);
    await emit({
      kind: 'job.created',
      job: id,
      stage: 'intake',
      actor: { type: 'person', name: person.name },
      summary: title,
      links: { issue: issue.url },
    });
    await reply(thread, {
      title: `Started ${id}: ${title}`,
      ...(askedForQuick
        ? {
            body: quick
              ? 'Quick: going straight to build, without a spec. QA is skipped only if the change turns out to be low-risk.'
              : 'Quick is not switched on for this project (policy.fast_lane), so every stage runs.',
          }
        : {}),
      links: [{ label: 'Issue', url: issue.url }],
    });
    await startStage(job, quick ? 'build' : 'spec');
  }

  async function answer(job: JobRecord, person: Person, text: string): Promise<void> {
    if (!hasRole(person, 'requester') && !hasRole(person, 'approver')) {
      await reply(job.thread, {
        title: 'Not done: answering needs the requester or approver role',
      });
      return;
    }
    const stage = job.resumeStage!;
    const resumed = { ...job, feedback: text };
    delete resumed.resumeStage;
    if (job.issue) await tracker.comment(job.issue, `Answer from ${person.name}: ${text}`);
    await startStage(resumed, stage, text);
  }

  async function revise(job: JobRecord, person: Person, feedback: string): Promise<void> {
    if (job.stage === 'awaiting-approval') {
      await emit({
        kind: 'approval.rejected',
        job: job.id,
        actor: { type: 'person', name: person.name },
        summary: feedback,
      });
    }
    let current = await stopActiveRun(job);
    current = { ...current, feedback };
    delete current.reviewedSha;
    if (current.issue)
      await tracker.comment(current.issue, `Revision from ${person.name}: ${feedback}`);
    await startStage(current, 'build', feedback);
  }

  async function merge(job: JobRecord, person: Person): Promise<void> {
    try {
      await gitHost.merge(job.pullRequest!, job.reviewedSha!);
    } catch (error) {
      if (error instanceof HeadMovedError) {
        await reply(job.thread, {
          title: 'Not merged: the pull request changed after it was reviewed',
        });
        return;
      }
      if (error instanceof MergeRefusedError) {
        await emit({
          kind: 'approval.rejected',
          job: job.id,
          actor: { type: 'system' },
          summary: `merge refused: ${error.reason}`,
        });
        await reply(job.thread, {
          title: `Not merged: ${error.reason}`,
          body: 'Sort that out on the pull request, then reply merge again.',
          links: [{ label: 'Pull request', url: job.pullRequest!.url }],
        });
        return;
      }
      throw error;
    }
    const merged = await moveTo(job, 'merged');
    await store.save(merged);
    await emit({
      kind: 'approval.given',
      job: job.id,
      actor: { type: 'person', name: person.name },
      summary: 'merge',
    });
    await emit({
      kind: 'merged',
      job: job.id,
      actor: { type: 'person', name: person.name },
      summary: `merged by ${person.name}`,
      links: { pr: job.pullRequest!.url },
    });
    await reply(job.thread, {
      title: `Merged ${job.id}`,
      links: [{ label: 'Pull request', url: job.pullRequest!.url }],
    });
  }

  async function deploy(job: JobRecord, person: Person, environment: string): Promise<void> {
    if (!deps.deployer) {
      await reply(job.thread, { title: 'Not done: no deployer is configured for this project' });
      return;
    }
    if (!job.pullRequest) {
      await reply(job.thread, { title: 'Not done: this job has no pull request to deploy' });
      return;
    }
    const result = await deps.deployer.deploy({
      jobId: job.id,
      environment,
      pullRequest: job.pullRequest,
    });
    const deployed = await moveTo(job, 'deployed');
    await store.save(deployed);
    await emit({
      kind: 'approval.given',
      job: job.id,
      actor: { type: 'person', name: person.name },
      summary: `deploy ${environment}`,
    });
    await emit({
      kind: 'deployed',
      job: job.id,
      actor: { type: 'person', name: person.name },
      summary: `deployed to ${environment}`,
    });
    await reply(job.thread, {
      title: `Deployed ${job.id} to ${environment}`,
      ...(result.url ? { links: [{ label: environment, url: result.url }] } : {}),
    });
  }

  async function cancel(job: JobRecord, person: Person): Promise<void> {
    const stopped = await stopActiveRun(job);
    const withoutQueue = { ...stopped };
    delete withoutQueue.queued;
    const cancelled = await moveTo(withoutQueue, 'cancelled');
    await store.save(cancelled);
    await reply(job.thread, { title: `Cancelled ${job.id}`, body: `Cancelled by ${person.name}.` });
    await drainQueue();
  }

  /**
   * Catches a job up with what people did on the tracker and git host directly. Returns true
   * when that finished the job.
   */
  async function catchUp(job: JobRecord): Promise<boolean> {
    if (FINISHED.includes(job.stage)) return false;
    if (job.pullRequest) {
      const { status } = await gitHost.pullRequestState(job.pullRequest);
      if (status === 'merged') {
        await finishOutside(job, 'merged', 'its pull request was merged');
        return true;
      }
      if (status === 'closed') {
        await finishOutside(job, 'cancelled', 'its pull request was closed without merging');
        return true;
      }
    }
    if (job.issue && tracker.isOpen && !(await tracker.isOpen(job.issue))) {
      await finishOutside(job, 'cancelled', 'its issue was closed');
      return true;
    }
    return false;
  }

  async function finishOutside(
    job: JobRecord,
    stage: 'merged' | 'cancelled',
    why: string,
  ): Promise<void> {
    const cleared = { ...(await stopActiveRun(job)) };
    delete cleared.queued;
    delete cleared.pendingConfirmation;
    delete cleared.resumeStage;
    const finished = await entered({ ...cleared, ...settle(cleared, stage, now()) });
    await store.save(finished);
    const links = job.pullRequest ? [{ label: 'Pull request', url: job.pullRequest.url }] : [];
    if (stage === 'merged') {
      await emit({
        kind: 'merged',
        job: job.id,
        actor: { type: 'system' },
        summary: 'merged outside the factory',
        ...(job.pullRequest ? { links: { pr: job.pullRequest.url } } : {}),
      });
    }
    await reply(job.thread, {
      title: stage === 'merged' ? `${job.id} is merged` : `${job.id} is cancelled`,
      body: `Anbiq noticed that ${why} outside the factory.`,
      ...(links.length > 0 ? { links } : {}),
    });
    await drainQueue();
  }

  async function reconcile(): Promise<void> {
    let failure: unknown;
    for (const job of await store.listUnfinished()) {
      try {
        await catchUp(job);
      } catch (error) {
        // One unreachable issue must not stop the others from being checked.
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }

  async function handleRunResult(result: RunResult): Promise<void> {
    const found = await store.get(result.jobId);
    // Ignore results from runs that were cancelled or replaced: only the active run may move a job.
    if (!found?.activeRun || found.activeRun.id !== result.runId) return;

    if (result.costUsd !== undefined) await store.recordCost(found.id, result.costUsd, now());
    if (found.issue) await tracker.release(found.issue, result.runId);
    const job: JobRecord = { ...found };
    delete job.activeRun;
    // Saved before deciding what comes next, so this run no longer counts against the concurrency limit.
    await store.save(job);

    await emit({
      kind: 'run.finished',
      job: job.id,
      stage: result.stage,
      actor: { type: 'crew', role: result.stage, run: result.runId },
      summary: `${result.stage} ${result.outcome}: ${result.summary}`,
      ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    });

    if (result.outcome === 'needs-input') {
      await block(job, result.stage, result.question ?? result.summary, true);
    } else if (result.outcome === 'failed') {
      await onFailed(job, result);
    } else {
      await onPassed(job, result);
    }
    await drainQueue();
  }

  async function block(
    job: JobRecord,
    stage: CrewStage,
    reason: string,
    isQuestion: boolean,
  ): Promise<void> {
    const blocked = await moveTo(job, 'blocked');
    await store.save({ ...blocked, resumeStage: stage });
    if (job.issue) await tracker.comment(job.issue, reason);
    await reply(job.thread, {
      title: isQuestion ? `${job.id} has a question` : `${job.id} needs a person`,
      body: isQuestion ? `${reason}\n\nReply in this thread to answer.` : reason,
    });
  }

  async function onFailed(job: JobRecord, result: RunResult): Promise<void> {
    if (result.stage === 'qa' || result.stage === 'review') {
      const bounced = { ...job, bounces: job.bounces + 1 };
      delete bounced.reviewedSha;
      if (bounced.bounces > config.policy.max_bounces) {
        await block(
          bounced,
          'build',
          `Sent back to build ${job.bounces} times without passing ${result.stage}: ${result.summary}`,
          false,
        );
        return;
      }
      await startStage(bounced, 'build', result.summary);
      return;
    }
    await block(
      job,
      result.stage,
      `The ${result.stage} crew could not finish: ${result.summary}`,
      false,
    );
  }

  async function onPassed(job: JobRecord, result: RunResult): Promise<void> {
    switch (result.stage) {
      case 'spec': {
        const specified = { ...job, spec: result.summary };
        if (job.issue)
          await tracker.comment(job.issue, `Acceptance criteria:\n\n${result.summary}`);
        await startStage(specified, 'build');
        return;
      }
      case 'build': {
        let current = job;
        if (!current.pullRequest) {
          const pr = await gitHost.openPullRequest({
            jobId: job.id,
            branch: job.branch,
            title: job.title,
            body: `${result.summary}\n\nRequested by ${job.requestedBy}.${job.issue ? `\n\nCloses ${job.issue.url}` : ''}`,
          });
          current = { ...current, pullRequest: pr };
          await emit({
            kind: 'pr.opened',
            job: job.id,
            actor: { type: 'system' },
            summary: job.title,
            links: { pr: pr.url },
          });
        }
        await startStage(current, (await maySkipQa(current)) ? 'review' : 'qa');
        return;
      }
      case 'qa':
        await startStage(job, 'review');
        return;
      case 'review': {
        if (!result.headSha) {
          await block(
            job,
            'review',
            'The review passed without reporting which commit it reviewed',
            false,
          );
          return;
        }
        const waiting = await moveTo({ ...job, reviewedSha: result.headSha }, 'awaiting-approval');
        await store.save(waiting);
        await emit({
          kind: 'approval.requested',
          job: job.id,
          actor: { type: 'system' },
          summary: result.summary,
        });
        await reply(job.thread, {
          title: `${job.id} is ready for your review`,
          body: result.summary,
          ...(waiting.pullRequest
            ? { links: [{ label: 'Pull request', url: waiting.pullRequest.url }] }
            : {}),
          actions: [
            { label: 'Merge', command: 'merge' },
            { label: 'Revise', command: 'revise: ' },
          ],
        });
        return;
      }
    }
  }

  /**
   * A change that only touches the project's fast-lane paths, and is small, goes from build
   * straight to review. The decision is made from the pull request's files, so it holds for
   * every attempt: a revision that starts touching code gets QA again.
   */
  async function maySkipQa(job: JobRecord): Promise<boolean> {
    const lane = config.policy.fast_lane;
    if (!lane || !job.pullRequest || !gitHost.changedFiles) return false;
    let verdict;
    try {
      verdict = fastLaneVerdict(await gitHost.changedFiles(job.pullRequest), lane);
    } catch {
      // Not knowing what changed is a reason to test it, not to skip the test.
      return false;
    }
    if (verdict.ok) {
      if (job.issue) {
        await tracker.comment(
          job.issue,
          `QA skipped: the change only touches fast-lane files (${verdict.files} file${verdict.files === 1 ? '' : 's'}, ${verdict.changedLines} changed lines). Review still runs.`,
        );
      }
      return true;
    }
    if (job.quick) {
      if (job.issue) {
        await tracker.comment(job.issue, `Not a fast-lane change: ${verdict.reason}. QA runs.`);
      }
      await reply(job.thread, {
        title: `${job.id} is not a quick change after all`,
        body: `${capitalise(verdict.reason)}, so QA runs before review.`,
      });
    }
    return false;
  }

  function statusOf(job: JobRecord): OutboundMessage {
    const fields = [
      { label: 'Stage', value: job.stage },
      { label: 'Requested by', value: job.requestedBy },
      { label: 'Revisions', value: String(job.revisions) },
    ];
    if (job.activeRun) fields.push({ label: 'Running', value: `${job.activeRun.stage} crew` });
    if (job.queued) fields.push({ label: 'Queued', value: job.queued.stage });
    const links = [
      ...(job.issue ? [{ label: 'Issue', url: job.issue.url }] : []),
      ...(job.pullRequest ? [{ label: 'Pull request', url: job.pullRequest.url }] : []),
    ];
    return { title: `${job.id}: ${job.title}`, fields, ...(links.length > 0 ? { links } : {}) };
  }

  async function projectStatus(): Promise<OutboundMessage> {
    const usage = await store.usage(now());
    return {
      title: `${config.project}: ${config.enabled ? 'running' : 'switched off'}`,
      fields: [
        {
          label: 'Jobs running',
          value: `${usage.runningJobs} of ${config.budgets.concurrent_jobs}`,
        },
        { label: 'Jobs today', value: `${usage.jobsToday} of ${config.budgets.jobs_per_day}` },
        {
          label: 'Spend today',
          value:
            config.budgets.usd_per_day === undefined
              ? `$${usage.usdToday.toFixed(2)}`
              : `$${usage.usdToday.toFixed(2)} of $${config.budgets.usd_per_day}`,
        },
      ],
    };
  }

  return { handleHttp, handleMessage, handleRunResult, reconcile };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function titleOf(request: string): string {
  const firstLine = request.split('\n')[0]?.trim() ?? '';
  return firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
}
