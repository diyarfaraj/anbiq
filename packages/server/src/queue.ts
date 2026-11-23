import { errorFields, type Logger } from './log.js';

/**
 * Runs tasks one at a time, in arrival order. The factory reads and writes a job in several
 * steps, so two messages or callbacks for the same job must never interleave.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly logger: Logger) {}

  /** Runs the task after everything queued before it, and returns its result. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Queues a task without waiting for it. Failures are logged. */
  defer(task: () => Promise<void>, label: string): void {
    this.run(task).catch((error: unknown) =>
      this.logger.log('error', `${label} failed`, errorFields(error)),
    );
  }

  /** Resolves when everything queued so far has finished. */
  async idle(): Promise<void> {
    await this.tail;
  }
}
