export type Command =
  | { type: 'request'; text: string }
  | { type: 'revise'; text: string }
  | { type: 'merge' }
  | { type: 'deploy'; environment: string }
  | { type: 'status' }
  | { type: 'cancel' };

export type CommandResult = { ok: true; command: Command } | { ok: false; error: string };

const REVISE = /^revise\s*:\s*([\s\S]*)$/i;
const DEPLOY = /^deploy(?:\s+(\S+))?$/i;

/**
 * Commands are exact so a request can never be mistaken for one: "merge" merges,
 * "merge the header changes" is a new request.
 */
export function parseCommand(input: string): CommandResult {
  const message = input.trim();
  if (message.length === 0) {
    return { ok: false, error: 'the message is empty' };
  }

  const revise = REVISE.exec(message);
  if (revise) {
    const feedback = (revise[1] ?? '').trim();
    return feedback.length > 0
      ? { ok: true, command: { type: 'revise', text: feedback } }
      : { ok: false, error: 'revise needs feedback, for example "revise: make the button larger"' };
  }

  const lower = message.toLowerCase();
  if (lower === 'merge') return { ok: true, command: { type: 'merge' } };
  if (lower === 'status') return { ok: true, command: { type: 'status' } };
  if (lower === 'cancel') return { ok: true, command: { type: 'cancel' } };

  const deploy = DEPLOY.exec(message);
  if (deploy) {
    const environment = deploy[1]?.toLowerCase();
    return environment
      ? { ok: true, command: { type: 'deploy', environment } }
      : { ok: false, error: 'deploy needs an environment, for example "deploy production"' };
  }

  return { ok: true, command: { type: 'request', text: message } };
}

/** The canonical text of a command, used to match `policy.confirm_commands`. */
export function commandText(command: Command): string {
  switch (command.type) {
    case 'request':
      return 'request';
    case 'revise':
      return 'revise';
    case 'deploy':
      return `deploy ${command.environment}`;
    default:
      return command.type;
  }
}
