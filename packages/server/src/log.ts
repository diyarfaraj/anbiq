export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
}

/**
 * One JSON object per line. Callers pass identifiers and outcomes only; message bodies,
 * headers and secrets are never logged.
 */
export function jsonLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  return {
    log(level, message, fields = {}) {
      write(JSON.stringify({ at: new Date().toISOString(), level, message, ...fields }));
    },
  };
}

export function errorFields(error: unknown): LogFields {
  return error instanceof Error
    ? { error: error.name, detail: error.message }
    : { error: String(error) };
}
