#!/usr/bin/env node
import { createServer } from 'node:http';
import { buildApp, loadSettings, StartupError } from './app.js';
import { createHandler } from './http.js';
import { errorFields, jsonLogger } from './log.js';

const logger = jsonLogger();

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
  const server = createServer(
    createHandler({
      factory: app.factory,
      queue: app.queue,
      callbackSecret: app.settings.ANBIQ_CALLBACK_SECRET,
      logger,
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

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.log('info', 'stopping', { signal });
    server.close(() => {
      void app.queue
        .idle()
        .catch(() => undefined)
        .finally(() => {
          app.database.close();
          process.exit(0);
        });
    });
    setTimeout(() => process.exit(1), 25_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('unhandledRejection', (error) =>
    logger.log('error', 'unhandled rejection', errorFields(error)),
  );
}

start();
