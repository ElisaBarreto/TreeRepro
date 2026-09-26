import type { MiddlewareHandler } from 'hono';
import { bearerToken } from '../auth/api-keys.ts';
import type { AppEnv } from './env.ts';
import { AppError } from './errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * @rfc RFC-02 R3
 * @rfc RFC-82 R5
 */
export function originCheck(appOrigin: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // RFC-82 R5: a Bearer header with no Cookie header cannot be a browser's
    // cross-site request, so it is exempt from the Origin check. This runs
    // before resolveSession and only exempts a header `bearerToken` can
    // actually parse into a token — a malformed one (empty, or more than one
    // word) still needs a valid Origin here and is rejected as a failed key
    // attempt by resolveSession afterwards, never treated as anonymous.
    const bearerOnly =
      bearerToken(c.req.header('authorization')) !== null && !c.req.header('cookie');
    if (!bearerOnly && !SAFE_METHODS.has(c.req.method) && c.req.header('origin') !== appOrigin) {
      throw new AppError('SECURITY_INVALID_ORIGIN', 'Request origin is not allowed');
    }
    await next();
  };
}
