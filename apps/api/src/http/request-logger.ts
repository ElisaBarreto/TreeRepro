import type { MiddlewareHandler } from 'hono';
import type { Logger } from '../logger.ts';
import type { AppEnv } from './env.ts';

/**
 * Binds a child of the process logger, carrying the request id, to the
 * context. Must run after `requestId()`.
 * @rfc RFC-10 R12
 */
export function requestLogger(base: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('logger', base.child({ requestId: c.get('requestId') }));
    await next();
  };
}
