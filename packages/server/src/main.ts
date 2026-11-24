#!/usr/bin/env node
import { createServer, type Server } from 'node:http';
import { buildApp, loadSettings, StartupError } from './app.js';
import { createBoard } from './board.js';
import { createDemo, demoSecret } from './demo.js';
import { createHandler } from './http.js';
import { errorFields, jsonLogger, type Logger } from './log.js';
import type { SerialQueue } from './queue.js';
import type { SqliteDatabase } from './sqlite.js';

const logger = jsonLogger();
const RECONCILE_EVERY_MS = 2 * 60 * 1000;

function start(): void {
  let loaded;
  try {
    loaded = loadSettings(process.env);
  } catch (error) {
    if (error instanceof StartupError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const app = buildApp(loaded.settings, loaded.config, process.env, { logger });
  const { settings } = app;
  const server = createServer(
    createHandler({
      factory: app.factory,
      queue: app.queue,
      callbackSecret: settings.ANBIQ_CALLBACK_SECRET,
      logger,
      ...(settings.ANBIQ_BOARD_PASSWORD
        ? {
            board: createBoard({
              password: settings.ANBIQ_BOARD_PASSWORD,
              sessionSecret: settings.ANBIQ_CALLBACK_SECRET,
              config: app.config,
              store: app.store,
              events: app.events,
              logger,
            }),
          }
        : {}),
      ...(settings.ANBIQ_EVENTS_SECRET
        ? { events: { sink: app.events, secret: settings.ANBIQ_EVENTS_SECRET } }
        : {}),
    }),
  );
  server.requestTimeout = 30_000;

  server.listen(app.settings.PORT, () => {
    logger.log('info', 'listening', {
      port: app.settings.PORT,
      project: app.config.project,
      taps: Object.keys(app.config.taps).join(','),
      enabled: app.config.enabled,
    });
  });
  // People also merge and close things on GitHub itself. Checking through the same queue as
  // messages and callbacks keeps a job from being changed by two things at once.
  setInterval(
    () => app.queue.defer(() => app.factory.reconcile(), 'reconcile'),
    RECONCILE_EVERY_MS,
  ).unref();
  stopOnSignals(server, app.queue, app.database, logger);
}

/** The real factory with a simulated outside world, on this machine only, for trying the board. */
function startDemo(): void {
  const quiet: Logger = {
    log: (level, message, fields) => {
      if (level === 'error') logger.log(level, message, fields);
    },
  };
  const demo = createDemo({ logger: quiet });
  const secret = demoSecret();
  const server = createServer(
    createHandler({
      factory: demo.factory,
      queue: demo.queue,
      callbackSecret: secret,
      logger: quiet,
      board: createBoard({
        password: secret,
        sessionSecret: secret,
        config: demo.config,
        store: demo.store,
        events: demo.events,
        logger: quiet,
        demo: true,
      }),
    }),
  );
  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(
      `Anbiq demo: the real factory with simulated chat, GitHub and crews.\n` +
        `Open http://localhost:${port}/board (this machine only). Ctrl+C to stop.\n`,
    );
    demo.start();
  });
  stopOnSignals(server, demo.queue, demo.database, logger, () => demo.stop());
}

function stopOnSignals(
  server: Server,
  queue: SerialQueue,
  database: SqliteDatabase,
  log: Logger,
  beforeClose?: () => void,
): void {
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.log('info', 'stopping', { signal });
    beforeClose?.();
    server.close(() => {
      void queue
        .idle()
        .catch(() => undefined)
        .finally(() => {
          database.close();
          process.exit(0);
        });
    });
    // Live board streams never end on their own.
    server.closeAllConnections();
    setTimeout(() => process.exit(1), 25_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('unhandledRejection', (error) =>
    log.log('error', 'unhandled rejection', errorFields(error)),
  );
}

if (process.argv.includes('--demo')) startDemo();
else start();
