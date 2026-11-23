import { readFileSync } from 'node:fs';
import { createFactory, parseConfig, type AnbiqConfig, type Factory, type Tap } from '@anbiq/core';
import { ClaudeCodeEngine } from '@anbiq/engine-claude-code';
import { GitHubAppAuth, GitHubGitHost, GitHubTracker, type TokenProvider } from '@anbiq/github';
import { GitHubActionsRunner } from '@anbiq/runner-github-actions';
import { SlackTap } from '@anbiq/tap-slack';
import { WhatsAppTap } from '@anbiq/tap-whatsapp-twilio';
import { z } from 'zod';
import { SqliteEventSink } from './events.js';
import type { Logger } from './log.js';
import { SerialQueue } from './queue.js';
import { SqliteConversationMemory, SqliteDatabase, SqliteJobStore } from './sqlite.js';

export class StartupError extends Error {
  constructor(readonly problems: string[]) {
    super(`Anbiq cannot start:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'StartupError';
  }
}

const MISSING = { error: 'is required' };
const required = z.string(MISSING).trim().min(1, 'is required');

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  ANBIQ_CONFIG: required.default('anbiq.yml'),
  ANBIQ_DATA: required.default('data/anbiq.db'),
  ANBIQ_PUBLIC_URL: z.url({ protocol: /^https$/, message: 'must be an https URL' }),
  ANBIQ_CALLBACK_SECRET: z.string(MISSING).min(32, 'must be at least 32 characters'),
  GITHUB_REPOSITORY: z.string(MISSING).regex(/^[\w.-]+\/[\w.-]+$/, 'must look like owner/repo'),
  GITHUB_APP_ID: required,
  GITHUB_APP_PRIVATE_KEY: required,
  GITHUB_APP_INSTALLATION_ID: required,
  ANBIQ_BASE_BRANCH: required.default('main'),
  ANBIQ_WORKFLOW: required.default('anbiq-run.yml'),
  /** Turns on the board at /board. */
  ANBIQ_BOARD_PASSWORD: z.string().min(12, 'must be at least 12 characters').optional(),
  /** Turns on POST /events for factories running elsewhere. */
  ANBIQ_EVENTS_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
});

export type Settings = z.infer<typeof envSchema>;

const slackOptions = z.object({ channels: z.array(required).min(1) }).strict();
const whatsappOptions = z
  .object({
    from: z.string().regex(/^\+[1-9]\d{1,14}$/, 'must be an E.164 number'),
    template_content_sid: required.optional(),
  })
  .strict();

/** What each supported slot value is called in anbiq.yml. */
const SUPPORTED = {
  tracker: ['github-issues'],
  git_host: ['github'],
  runner: ['github-actions'],
  engine: ['claude-code'],
} as const;

export interface App {
  factory: Factory;
  queue: SerialQueue;
  database: SqliteDatabase;
  store: SqliteJobStore;
  events: SqliteEventSink;
  settings: Settings;
  config: AnbiqConfig;
}

/** Reads the environment and anbiq.yml, and refuses to start with every problem listed. */
export function loadSettings(env: NodeJS.ProcessEnv): { settings: Settings; config: AnbiqConfig } {
  const parsedEnv = envSchema.safeParse(env);
  const problems = parsedEnv.success
    ? []
    : parsedEnv.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
  if (!parsedEnv.success) throw new StartupError(problems);
  const settings = parsedEnv.data;

  let source: string;
  try {
    source = readFileSync(settings.ANBIQ_CONFIG, 'utf8');
  } catch {
    throw new StartupError([`cannot read the config file ${settings.ANBIQ_CONFIG}`]);
  }
  const parsedConfig = parseConfig(source);
  if (!parsedConfig.ok) {
    throw new StartupError(parsedConfig.errors.map((error) => `anbiq.yml ${error}`));
  }
  const config = parsedConfig.config;

  const slots: [keyof typeof SUPPORTED, string][] = [
    ['tracker', config.tracker],
    ['git_host', config.git_host],
    ['runner', config.runner],
    ['engine', config.engine.id],
  ];
  for (const [slot, value] of slots) {
    const supported: readonly string[] = SUPPORTED[slot];
    if (!supported.includes(value)) {
      problems.push(`anbiq.yml ${slot} "${value}" is not supported; use ${supported.join(', ')}`);
    }
  }
  for (const tap of Object.keys(config.taps)) {
    if (!(tap in TAP_SECRETS)) {
      problems.push(
        `anbiq.yml taps.${tap} is not supported; use ${Object.keys(TAP_SECRETS).join(', ')}`,
      );
      continue;
    }
    for (const name of TAP_SECRETS[tap as keyof typeof TAP_SECRETS]) {
      if (!env[name]?.trim()) problems.push(`${name} is required for the ${tap} tap`);
    }
    const schema = tap === 'slack' ? slackOptions : whatsappOptions;
    const tapOptions = schema.safeParse(config.taps[tap]);
    if (!tapOptions.success) {
      for (const issue of tapOptions.error.issues) {
        problems.push(`anbiq.yml taps.${tap}.${issue.path.join('.')} ${issue.message}`);
      }
    }
  }
  if (problems.length > 0) throw new StartupError(problems);
  return { settings, config };
}

const TAP_SECRETS = {
  slack: ['SLACK_SIGNING_SECRET', 'SLACK_BOT_TOKEN'],
  'whatsapp-twilio': ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
} as const;

export interface BuildOptions {
  logger: Logger;
  /** Overrides for tests. */
  auth?: TokenProvider;
  fetch?: typeof fetch;
  now?: () => Date;
}

export function buildApp(
  settings: Settings,
  config: AnbiqConfig,
  env: NodeJS.ProcessEnv,
  options: BuildOptions,
): App {
  const database = new SqliteDatabase(settings.ANBIQ_DATA);
  const queue = new SerialQueue(options.logger);
  const [owner, repo] = settings.GITHUB_REPOSITORY.split('/') as [string, string];
  const io = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
  const auth =
    options.auth ??
    new GitHubAppAuth({
      appId: settings.GITHUB_APP_ID,
      privateKey: settings.GITHUB_APP_PRIVATE_KEY.replaceAll('\\n', '\n'),
      installationId: settings.GITHUB_APP_INSTALLATION_ID,
      ...io,
    });
  const repository = {
    owner,
    repo,
    auth,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };

  const taps: Tap[] = Object.entries(config.taps).map(([id, raw]) => {
    if (id === 'slack') {
      const tapOptions = slackOptions.parse(raw);
      return new SlackTap({
        signingSecret: env.SLACK_SIGNING_SECRET!,
        botToken: env.SLACK_BOT_TOKEN!,
        channels: tapOptions.channels,
        ...io,
      });
    }
    const tapOptions = whatsappOptions.parse(raw);
    return new WhatsAppTap({
      accountSid: env.TWILIO_ACCOUNT_SID!,
      authToken: env.TWILIO_AUTH_TOKEN!,
      from: tapOptions.from,
      webhookUrl: `${settings.ANBIQ_PUBLIC_URL.replace(/\/$/, '')}/taps/${id}`,
      memory: new SqliteConversationMemory(database),
      ...(tapOptions.template_content_sid
        ? { templateContentSid: tapOptions.template_content_sid }
        : {}),
      ...io,
    });
  });

  const store = new SqliteJobStore(database, options.now ? { now: options.now } : {});
  const events = new SqliteEventSink(database);
  const factory = createFactory({
    config,
    events: [events],
    taps,
    tracker: new GitHubTracker(repository),
    gitHost: new GitHubGitHost({ ...repository, baseBranch: settings.ANBIQ_BASE_BRANCH }),
    runner: new GitHubActionsRunner({
      ...repository,
      workflow: settings.ANBIQ_WORKFLOW,
      ref: settings.ANBIQ_BASE_BRANCH,
    }),
    engine: new ClaudeCodeEngine(),
    store,
    defer: (task) => queue.defer(task, 'message'),
    ...(options.now ? { now: options.now } : {}),
  });

  return { factory, queue, database, store, events, settings, config };
}
