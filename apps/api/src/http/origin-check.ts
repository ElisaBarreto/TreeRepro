import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env.ts';
import { AppError } from './errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** @rfc RFC-02 R3 */
export function originCheck(appOrigin: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header('origin') !== appOrigin) {
      throw new AppError('SECURITY_INVALID_ORIGIN', 'Request origin is not allowed');
    }
    await next();
  };
}
