import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Factory, HttpResponse } from '@anbiq/core';
import { parseCallback, verifyCallback } from '@anbiq/runner-github-actions';
import { errorFields, type Logger } from './log.js';
import type { SerialQueue } from './queue.js';

/** Webhook and callback bodies are small; anything larger is refused unread. */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface HandlerOptions {
  factory: Pick<Factory, 'handleHttp' | 'handleRunResult'>;
  queue: SerialQueue;
  callbackSecret: string;
  logger: Logger;
  now?: () => Date;
}

class BodyTooLargeError extends Error {}

export function createHandler(options: HandlerOptions) {
  const { factory, queue, callbackSecret, logger } = options;

  async function route(request: IncomingMessage): Promise<HttpResponse> {
    const url = new URL(request.url ?? '/', 'http://anbiq.local');
    const path = url.pathname;

    if (request.method === 'GET' && path === '/healthz') {
      return { status: 200, body: 'ok', contentType: 'text/plain' };
    }

    const tap = /^\/taps\/([a-z0-9-]+)$/.exec(path)?.[1];
    if (request.method === 'POST' && tap) {
      const body = await readBody(request);
      return factory.handleHttp(tap, {
        method: 'POST',
        url: request.url ?? path,
        headers: flatHeaders(request),
        body,
      });
    }

    const runId = /^\/runs\/([A-Za-z0-9-]{1,64})$/.exec(path)?.[1];
    if (request.method === 'POST' && runId) {
      const body = await readBody(request);
      const verified = verifyCallback({
        secret: callbackSecret,
        body,
        timestamp: header(request, 'x-anbiq-timestamp'),
        signature: header(request, 'x-anbiq-signature'),
        ...(options.now ? { now: options.now() } : {}),
      });
      if (!verified) return { status: 401 };
      const parsed = parseCallback(body, runId);
      if (!parsed.ok) {
        logger.log('warn', 'run callback refused', { runId, reason: parsed.error });
        return { status: 400, body: parsed.error, contentType: 'text/plain' };
      }
      await queue.run(() => factory.handleRunResult(parsed.result));
      logger.log('info', 'run finished', {
        runId,
        jobId: parsed.result.jobId,
        stage: parsed.result.stage,
        outcome: parsed.result.outcome,
      });
      return { status: 200 };
    }

    return { status: 404 };
  }

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const started = Date.now();
    let result: HttpResponse;
    try {
      result = await route(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        result = { status: 413 };
      } else {
        logger.log('error', 'request failed', errorFields(error));
        result = { status: 500 };
      }
    }
    response.statusCode = result.status;
    if (result.contentType) response.setHeader('content-type', result.contentType);
    response.end(result.body ?? '');
    logger.log(result.status >= 500 ? 'error' : 'info', 'request', {
      method: request.method,
      path: new URL(request.url ?? '/', 'http://anbiq.local').pathname,
      status: result.status,
      ms: Date.now() - started,
    });
  };
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}

function flatHeaders(request: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const name of Object.keys(request.headers)) headers[name] = header(request, name);
  return headers;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) throw new BodyTooLargeError();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
