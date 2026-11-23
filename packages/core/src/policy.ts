import { commandText, type Command } from './command.js';
import type { AnbiqConfig } from './config.js';
import { hasRole, type Person } from './identity.js';
import type { Job } from './job.js';
import type { Stage } from './stage.js';

export type Decision =
  | { outcome: 'allow' }
  | { outcome: 'deny'; reason: string }
  | { outcome: 'confirm'; reason: string };

export interface PullRequestState {
  checksPassed: boolean;
  headSha: string;
  /** The commit the review crew approved. Merging any other commit is refused. */
  reviewedSha?: string;
}

export interface PolicyContext {
  config: AnbiqConfig;
  person: Person | undefined;
  job?: Job;
  pullRequest?: PullRequestState;
  /** True when the person has already answered a confirmation prompt for this command. */
  confirmed?: boolean;
}

const REVISABLE: readonly Stage[] = ['build', 'qa', 'review', 'awaiting-approval'];
const FINISHED: readonly Stage[] = ['merged', 'deployed', 'cancelled'];

const allow: Decision = { outcome: 'allow' };
const deny = (reason: string): Decision => ({ outcome: 'deny', reason });

/** Decides whether a person may run a command. Every command passes through here before anything happens. */
export function decide(command: Command, ctx: PolicyContext): Decision {
  const { config, person } = ctx;

  if (!person) {
    return deny("you are not on this project's allowlist");
  }
  if (command.type === 'status') {
    return allow;
  }
  if (!config.enabled) {
    return deny('Anbiq is switched off for this project (enabled: false)');
  }

  const decision = decideCommand(command, ctx, person);
  if (decision.outcome !== 'allow') {
    return decision;
  }

  if (config.policy.confirm_commands.includes(commandText(command)) && !ctx.confirmed) {
    return { outcome: 'confirm', reason: `"${commandText(command)}" needs a second confirmation` };
  }
  return allow;
}

function decideCommand(command: Command, ctx: PolicyContext, person: Person): Decision {
  const { config, job, pullRequest } = ctx;

  switch (command.type) {
    case 'request':
      return hasRole(person, 'requester')
        ? allow
        : deny('starting new work needs the requester role');

    case 'revise': {
      if (!hasRole(person, 'requester') && !hasRole(person, 'approver')) {
        return deny('revising needs the requester or approver role');
      }
      if (!job) return deny('there is no job in this conversation to revise');
      if (!REVISABLE.includes(job.stage)) {
        return deny(`a job in "${job.stage}" cannot be revised`);
      }
      if (job.revisions >= config.policy.max_revisions) {
        return deny(
          `this job has reached ${config.policy.max_revisions} revisions; a person needs to take over`,
        );
      }
      return allow;
    }

    case 'merge': {
      if (!hasRole(person, 'approver')) return deny('merging needs the approver role');
      if (!job) return deny('there is no job in this conversation to merge');
      if (job.stage !== 'awaiting-approval') {
        return deny(`a job in "${job.stage}" is not ready to merge`);
      }
      if (!pullRequest) return deny('this job has no pull request');
      if (!pullRequest.checksPassed) return deny('the required checks have not passed');
      if (
        pullRequest.reviewedSha === undefined ||
        pullRequest.reviewedSha !== pullRequest.headSha
      ) {
        return deny('the pull request changed after it was reviewed; it needs a fresh review');
      }
      return allow;
    }

    case 'deploy': {
      if (!hasRole(person, 'approver')) return deny('deploying needs the approver role');
      if (!config.policy.deploy_environments.includes(command.environment)) {
        return deny(
          `"${command.environment}" is not a deploy environment; allowed: ${config.policy.deploy_environments.join(', ')}`,
        );
      }
      if (!job) return deny('there is no job in this conversation to deploy');
      if (job.stage !== 'merged' && job.stage !== 'deployed') {
        return deny(`a job in "${job.stage}" has not been merged`);
      }
      return allow;
    }

    case 'cancel': {
      if (!job) return deny('there is no job in this conversation to cancel');
      if (FINISHED.includes(job.stage)) return deny(`a job in "${job.stage}" cannot be cancelled`);
      const isOwnJob = job.requestedBy === person.name;
      return isOwnJob || hasRole(person, 'approver')
        ? allow
        : deny('only the person who asked for this job or an approver can cancel it');
    }

    case 'status':
      return allow;
  }
}
