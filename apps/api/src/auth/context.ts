import type { PermissionCache } from '../access/permissions.ts';
import type { Db } from '../db/client.ts';
import type { DoiClient } from '../integrations/doi.ts';
import type { Logger } from '../logger.ts';
import type { Mailer } from '../mail/mailer.ts';
import type { Redis } from '../redis/client.ts';
import type { PasswordBreachChecker } from './breach-check.ts';
import type { MfaStore } from './mfa.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { SessionStore } from './sessions.ts';

/** Everything an authentication flow needs; built once by `createApp`. */
export interface AuthContext {
  db: Db;
  redis: Redis;
  sessions: SessionStore;
  mfa: MfaStore;
  limiter: RateLimiter;
  mailer: Mailer;
  breachChecker: PasswordBreachChecker;
  permissionCache: PermissionCache;
  logger: Logger;
  doi: DoiClient;
  appOrigin: string;
  now: () => number;
}

export interface RequestMeta {
  ip: string;
  userAgent: string;
}
