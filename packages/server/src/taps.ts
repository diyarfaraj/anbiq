import type { ConversationMemory, Tap } from '@anbiq/core';
import { DiscordTap } from '@anbiq/tap-discord';
import { SlackTap } from '@anbiq/tap-slack';
import { TelegramTap } from '@anbiq/tap-telegram';
import { WhatsAppTap } from '@anbiq/tap-whatsapp-twilio';
import { z } from 'zod';

const text = z.string().trim().min(1, 'is required');

export interface TapContext {
  env: NodeJS.ProcessEnv;
  /** The public URL of this tap's webhook, for platforms that sign it. */
  webhookUrl: string;
  memory: ConversationMemory;
  io: { fetch?: typeof fetch; now?: () => Date };
}

interface TapDefinition<T extends z.ZodType> {
  /** Environment variables holding the tap's secrets. */
  secrets: readonly string[];
  /** The tap's options under taps.<id> in anbiq.yml. */
  options: T;
  build(options: z.infer<T>, context: TapContext): Tap;
}

const define = <T extends z.ZodType>(definition: TapDefinition<T>) => definition;

/** Every chat platform the server can run, keyed by its id in anbiq.yml. */
export const TAPS = {
  slack: define({
    secrets: ['SLACK_SIGNING_SECRET', 'SLACK_BOT_TOKEN'],
    options: z.object({ channels: z.array(text).min(1) }).strict(),
    build: (options, { env, io }) =>
      new SlackTap({
        signingSecret: env.SLACK_SIGNING_SECRET!,
        botToken: env.SLACK_BOT_TOKEN!,
        channels: options.channels,
        ...io,
      }),
  }),
  'whatsapp-twilio': define({
    secrets: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    options: z
      .object({
        from: z.string().regex(/^\+[1-9]\d{1,14}$/, 'must be an E.164 number'),
        template_content_sid: text.optional(),
      })
      .strict(),
    build: (options, { env, webhookUrl, memory, io }) =>
      new WhatsAppTap({
        accountSid: env.TWILIO_ACCOUNT_SID!,
        authToken: env.TWILIO_AUTH_TOKEN!,
        from: options.from,
        webhookUrl,
        memory,
        ...(options.template_content_sid
          ? { templateContentSid: options.template_content_sid }
          : {}),
        ...io,
      }),
  }),
  telegram: define({
    secrets: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_SECRET_TOKEN'],
    options: z
      .object({
        chats: z.array(z.string().regex(/^-?\d+$/, 'must be numeric chat IDs')).min(1),
        bot_username: z
          .string()
          .regex(/^\w{5,32}$/, 'must be the bot username without "@"')
          .optional(),
      })
      .strict(),
    build: (options, { env, memory, io }) =>
      new TelegramTap({
        botToken: env.TELEGRAM_BOT_TOKEN!,
        secretToken: env.TELEGRAM_SECRET_TOKEN!,
        chats: options.chats,
        memory,
        ...(options.bot_username ? { botUsername: options.bot_username } : {}),
        ...io,
      }),
  }),
  discord: define({
    secrets: ['DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN'],
    options: z
      .object({
        channels: z.array(z.string().regex(/^\d+$/, 'must be numeric channel IDs')).min(1),
      })
      .strict(),
    build: (options, { env, memory, io }) =>
      new DiscordTap({
        publicKey: env.DISCORD_PUBLIC_KEY!.trim(),
        botToken: env.DISCORD_BOT_TOKEN!,
        channels: options.channels,
        memory,
        ...io,
      }),
  }),
} as const;

export type TapId = keyof typeof TAPS;

export const isTapId = (id: string): id is TapId => Object.hasOwn(TAPS, id);

/** Problems with one configured tap: unknown id, missing secrets or invalid options. */
export function checkTap(id: string, raw: unknown, env: NodeJS.ProcessEnv): string[] {
  if (!isTapId(id)) {
    return [`anbiq.yml taps.${id} is not supported; use ${Object.keys(TAPS).join(', ')}`];
  }
  const definition = TAPS[id];
  const problems = definition.secrets
    .filter((name) => !env[name]?.trim())
    .map((name) => `${name} is required for the ${id} tap`);
  const parsed = definition.options.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`anbiq.yml taps.${id}.${issue.path.join('.')} ${issue.message}`);
    }
  }
  return problems;
}

export function buildTap(id: string, raw: unknown, context: TapContext): Tap {
  if (!isTapId(id)) throw new Error(`unknown tap ${id}`);
  const definition = TAPS[id] as TapDefinition<z.ZodType>;
  return definition.build(definition.options.parse(raw), context);
}
