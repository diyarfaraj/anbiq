import type { OutboundMessage } from '@anbiq/core';

/** Slack's limit for the text of one section block. */
export const SECTION_LIMIT = 3000;
const FIELD_LIMIT = 2000;
const MAX_FIELDS = 10;

export type SlackBlock = Record<string, unknown>;

/** Escapes the three characters Slack treats as markup in mrkdwn text. */
export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Splits text into pieces Slack accepts, preferring line breaks. */
export function chunk(text: string, limit: number): string[] {
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

function trim(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

/** Renders a tap-neutral message as Slack Block Kit, within Slack's size limits. */
export function render(message: OutboundMessage): { text: string; blocks: SlackBlock[] } {
  const blocks: SlackBlock[] = [section(trim(`*${escapeText(message.title)}*`, SECTION_LIMIT))];

  if (message.body) {
    for (const piece of chunk(escapeText(message.body), SECTION_LIMIT)) {
      blocks.push(section(piece));
    }
  }

  if (message.fields && message.fields.length > 0) {
    blocks.push({
      type: 'section',
      fields: message.fields.slice(0, MAX_FIELDS).map((field) => ({
        type: 'mrkdwn',
        text: trim(`*${escapeText(field.label)}*\n${escapeText(field.value)}`, FIELD_LIMIT),
      })),
    });
  }

  if (message.links && message.links.length > 0) {
    const links = message.links
      .map((link) => `<${link.url}|${escapeText(link.label)}>`)
      .join('  ·  ');
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: trim(links, SECTION_LIMIT) }],
    });
  }

  if (message.actions && message.actions.length > 0) {
    const replies = message.actions
      .map((action) => `\`${action.command.trim() || action.label}\``)
      .join(' or ');
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Reply ${replies}` }] });
  }

  return { text: trim(message.title, SECTION_LIMIT), blocks };
}
