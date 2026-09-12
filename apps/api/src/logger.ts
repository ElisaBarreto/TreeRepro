import { type DestinationStream, type Logger, pino } from 'pino';
import type { LogLevel } from './config.ts';

/** @rfc RFC-02 R7 */
export const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'email',
  '*.email',
  'ip',
  '*.ip',
  'userAgent',
  '*.userAgent',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'user.name',
  'body.name',
  'input.name',
] as const;

export interface LoggerOptions {
  level: LogLevel;
  /** Defaults to stdout. Tests pass a capturing stream. */
  stream?: DestinationStream;
}

/**
 * @rfc RFC-02 R7
 * @rfc RFC-10 R12
 */
export function createLogger(options: LoggerOptions): Logger {
  const pinoOptions = {
    level: options.level,
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return options.stream ? pino(pinoOptions, options.stream) : pino(pinoOptions);
}

export type { Logger };
