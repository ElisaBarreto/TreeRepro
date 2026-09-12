import type { Db } from '../db/client.ts';
import type { Logger } from '../logger.ts';
import type { Mailer } from '../mail/mailer.ts';
import type { PasswordBreachChecker } from './breach-check.ts';
import type { MfaStore } from './mfa.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { SessionStore } from './sessions.ts';

/** Everything an authentication flow needs; built once by `createApp`. */
export interface AuthContext {
  db: Db;
  sessions: SessionStore;
  mfa: MfaStore;
  limiter: RateLimiter;
  mailer: Mailer;
  breachChecker: PasswordBreachChecker;
  logger: Logger;
  appOrigin: string;
  now: () => number;
}

export interface RequestMeta {
  ip: string;
  userAgent: string;
}
