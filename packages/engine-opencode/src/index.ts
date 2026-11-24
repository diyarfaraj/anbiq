import {
  FORBIDDEN,
  RESULT_FILE,
  buildPrompt,
  crewPermissions,
  type AgentEngine,
  type CrewPermissions,
  type CrewPromptInput,
  type EngineInvocation,
} from '@anbiq/core';

/** The OpenCode release the rules below were checked against. The workflow installs this one. */
export const OPENCODE_VERSION = '2.4.1';

/** The agent `opencode run` uses unless told otherwise. */
const AGENT = 'build';

export interface PermissionRule {
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
}

const allow = (action: string, resource: string): PermissionRule => ({
  action,
  resource,
  effect: 'allow',
});
const deny = (action: string, resource: string): PermissionRule => ({
  action,
  resource,
  effect: 'deny',
});

// OpenCode's "*" crosses path separators, so "**" has nothing to add.
const pathPattern = (glob: string): string => glob.replaceAll('**', '*');
// "cmd *" matches the command with any arguments, and the bare command as well.
const withArguments = (command: string): string => `${command} *`;

/**
 * The crew's permissions as an OpenCode ruleset. The last matching rule wins, so it starts by
 * denying everything, then allows what the crew is granted, and ends with what no crew may do.
 * A command line made of several commands is only allowed when every one of them is.
 */
export function permissionRules(permissions: CrewPermissions): PermissionRule[] {
  return [
    // Nothing is left to ask about: a headless run has nobody to answer.
    deny('*', '*'),
    allow('read', '*'),
    allow('glob', '*'),
    allow('grep', '*'),
    // "edit" covers every file-writing tool.
    allow('edit', permissions.editCode ? '*' : RESULT_FILE),
    ...permissions.commands.map((command) => allow('shell', withArguments(command))),
    ...(permissions.commit
      ? [
          allow('shell', withArguments('git add')),
          allow('shell', withArguments('git commit')),
          allow('shell', 'git status'),
        ]
      : []),
    ...(permissions.readHistory
      ? [allow('shell', withArguments('git diff')), allow('shell', withArguments('git log'))]
      : []),
    ...FORBIDDEN_RULES,
  ];
}

/** What every crew is forbidden. These come last, so no allow rule can override them. */
export const FORBIDDEN_RULES: PermissionRule[] = [
  ...FORBIDDEN.commands.map((command) => deny('shell', withArguments(command))),
  ...FORBIDDEN.bareCommands.map((command) => deny('shell', command)),
  ...(FORBIDDEN.network ? [deny('webfetch', '*'), deny('websearch', '*')] : []),
  // Files outside the repository, which "read *" would otherwise reach.
  deny('external_directory', '*'),
  ...FORBIDDEN.readPaths.flatMap((path) => [deny('read', path), deny('read', `*/${path}`)]),
  ...FORBIDDEN.writePaths.map((path) => deny('edit', pathPattern(path))),
];

export class OpenCodeEngine implements AgentEngine {
  readonly id = 'opencode';

  prepare(input: CrewPromptInput): EngineInvocation {
    const { stage, config } = input;
    if (!config.engine.model) {
      throw new Error('the opencode engine needs engine.model in anbiq.yml, as provider/model');
    }
    return {
      engine: this.id,
      prompt: buildPrompt(input),
      // An OpenCode config file. The runner makes it the only config the agent loads.
      settings: {
        permissions: permissionRules(crewPermissions(stage, config.checks.verify)),
        agents: { [AGENT]: { steps: config.engine.max_turns } },
      },
      maxTurns: config.engine.max_turns,
      timeoutMinutes: config.engine.timeout_minutes,
      model: config.engine.model,
    };
  }
}
