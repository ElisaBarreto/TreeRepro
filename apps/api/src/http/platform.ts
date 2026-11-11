import type { Platform } from '@treerepro/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env.ts';
import { AppError } from './errors.ts';

/**
 * The configured host of each platform; `plant` is null while `PLANT_DOMAIN` is unset.
 * @rfc RFC-14 R3
 */
export interface PlatformDomains {
  tree: string;
  plant: string | null;
}

// The Compose healthcheck calls `http://127.0.0.1:3000/api/health` (RFC-14 R3).
const HEALTH = /^\/api\/health(\/ready)?$/;

/**
 * The platform a host belongs to, port removed and case ignored; null for
 * any other host, and for PlantRepro's while it has no domain.
 * @rfc RFC-14 R3
 */
export function platformOfHost(
  host: string | undefined,
  domains: PlatformDomains,
): Platform | null {
  const name = host?.replace(/:\d*$/, '').toLowerCase();
  if (!name) return null;
  if (name === domains.tree.toLowerCase()) return 'treerepro';
  if (domains.plant && name === domains.plant.toLowerCase()) return 'plantrepro';
  return null;
}

/**
 * Sets `c.var.platform` from the request URL's host (the forwarded `Host`),
 * or answers 421 `UNKNOWN_HOST`; the health routes pass with no platform.
 * @rfc RFC-14 R3
 */
export function resolvePlatform(domains: PlatformDomains): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (HEALTH.test(c.req.path)) return next();
    const platform = platformOfHost(new URL(c.req.url).host, domains);
    if (!platform) throw new AppError('UNKNOWN_HOST', 'This host is not served here');
    c.set('platform', platform);
    await next();
  };
}
