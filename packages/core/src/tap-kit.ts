import type { InboundHttpRequest, OutboundMessage } from './ports.js';

/**
 * Small persistent key-value memory for taps on platforms without real threads: which
 * conversation a sent message belongs to, when someone last wrote, and similar.
 */
export interface ConversationMemory {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/** Fine for one process. Use a persistent store when the factory runs on more than one instance. */
export class InMemoryConversationMemory implements ConversationMemory {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

/**
 * Plain text for platforms without rich layouts. `bold` wraps the title in the platform's
 * own emphasis, and suggested replies become instructions.
 */
export function renderPlainText(
  message: OutboundMessage,
  options: { bold?: (text: string) => string; replyHint?: string } = {},
): string {
  const parts = [options.bold ? options.bold(message.title) : message.title];
  if (message.body) parts.push(message.body);
  if (message.fields && message.fields.length > 0) {
    parts.push(message.fields.map((field) => `${field.label}: ${field.value}`).join('\n'));
  }
  if (message.links && message.links.length > 0) {
    parts.push(message.links.map((link) => `${link.label}: ${link.url}`).join('\n'));
  }
  if (message.actions && message.actions.length > 0) {
    const replies = message.actions
      .map((action) => action.command.trim() || action.label)
      .join(' or ');
    parts.push(`${options.replyHint ?? 'Reply to this message with'}: ${replies}`);
  }
  return parts.join('\n\n');
}

/** Splits text into pieces no longer than `limit`, preferring to break at a newline. */
export function chunkText(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const cut = rest.lastIndexOf('\n', limit);
    const at = cut > limit / 2 ? cut : limit;
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, '');
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

/** A request header, matched case-insensitively. */
export function requestHeader(request: InboundHttpRequest, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}
