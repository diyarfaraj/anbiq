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

const READ = ['Read', 'Glob', 'Grep'];
/**
 * Claude Code checks every file-writing tool, Write included, against Edit rules. A path rule
 * spelled Write(…) grants nothing, and the crew then cannot report its result.
 */
const WRITE_RESULT = [`Edit(${RESULT_FILE})`];
const READ_HISTORY = ['Bash(git diff:*)', 'Bash(git log:*)'];
const COMMIT = ['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status)'];

/** What every crew is forbidden, as Claude Code deny rules. A deny rule beats any allow rule. */
export const DENIED_TOOLS: string[] = [
  ...FORBIDDEN.commands.map((command) => `Bash(${command}:*)`),
  ...FORBIDDEN.bareCommands.map((command) => `Bash(${command})`),
  ...(FORBIDDEN.network ? ['WebFetch', 'WebSearch'] : []),
  ...FORBIDDEN.readPaths.map((path) => `Read(./${path})`),
  ...FORBIDDEN.writePaths.flatMap((path) => [`Edit(${path})`, `Write(${path})`]),
];

/** The crew's permissions as Claude Code allow rules. Anything not listed is refused. */
export function allowedTools(permissions: CrewPermissions): string[] {
  return [
    ...READ,
    ...(permissions.editCode ? ['Edit', 'Write'] : WRITE_RESULT),
    ...permissions.commands.map((command) => `Bash(${command}:*)`),
    ...(permissions.commit ? COMMIT : []),
    ...(permissions.readHistory ? READ_HISTORY : []),
  ];
}

export class ClaudeCodeEngine implements AgentEngine {
  readonly id = 'claude-code';

  prepare(input: CrewPromptInput): EngineInvocation {
    const { stage, config } = input;
    return {
      engine: this.id,
      prompt: buildPrompt(input),
      // A Claude Code settings file: the runner hands it to the agent as it is.
      settings: {
        permissions: {
          allow: allowedTools(crewPermissions(stage, config.checks.verify)),
          deny: DENIED_TOOLS,
        },
      },
      maxTurns: config.engine.max_turns,
      timeoutMinutes: config.engine.timeout_minutes,
      ...(config.engine.model ? { model: config.engine.model } : {}),
    };
  }
}

export { CREW_INSTRUCTIONS, RESULT_FILE, buildPrompt, projectInstructionsFile } from '@anbiq/core';
