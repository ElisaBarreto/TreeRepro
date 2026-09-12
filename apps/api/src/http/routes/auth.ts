import { Hono } from 'hono';
import type { AuthContext } from '../../auth/context.ts';
import type { AppEnv } from '../env.ts';

/** @rfc RFC-22 R1 */
export function authRoutes(_ctx: AuthContext) {
  return new Hono<AppEnv>();
}
