import type { LogLevel } from '../../src/config.ts';
import { createLogger } from '../../src/logger.ts';

export function captureLogger(level: LogLevel = 'trace') {
  const lines: unknown[] = [];
  const logger = createLogger({
    level,
    stream: {
      write(chunk: string) {
        lines.push(JSON.parse(chunk));
      },
    },
  });
  return { logger, lines };
}
