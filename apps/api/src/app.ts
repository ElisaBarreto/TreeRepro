import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { PermissionCache } from './access/permissions.ts';
import type { PasswordBreachChecker } from './auth/breach-check.ts';
import type { AuthContext } from './auth/context.ts';
import type { MfaStore } from './auth/mfa.ts';
import type { RateLimiter } from './auth/rate-limit.ts';
import type { SessionStore } from './auth/sessions.ts';
import type { AppConfig } from './config.ts';
import type { Db } from './db/client.ts';
import type { AppEnv } from './http/env.ts';
import { createErrorHandler, errorBody } from './http/errors.ts';
import { globalRateLimit } from './http/middleware/rate-limit.ts';
import { resolveSession } from './http/middleware/session.ts';
import { originCheck } from './http/origin-check.ts';
import { requestLogger } from './http/request-logger.ts';
import { adminRoutes } from './http/routes/admin/index.ts';
import { authRoutes } from './http/routes/auth.ts';
import { datasetRoutes } from './http/routes/dataset/index.ts';
import { type HealthChecks, healthRoutes } from './http/routes/health.ts';
import { meRoutes } from './http/routes/me.ts';
import type { Logger } from './logger.ts';
import type { Mailer } from './mail/mailer.ts';
import type { DoiClient } from './integrations/doi.ts';

export interface AppDeps {
  config: Pick<AppConfig, 'appOrigin'>;
  logger: Logger;
  doi: DoiClient;
  health: HealthChecks;
  db: Db;
  sessions: SessionStore;
  mfa: MfaStore;
  limiter: RateLimiter;
  mailer: Mailer;
  breachChecker: PasswordBreachChecker;
  permissionCache: PermissionCache;
  /** Epoch ms; tests inject a controllable clock. */
  now?: () => number;
}

/** @rfc RFC-02 R4 */
export const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * @rfc RFC-11 R1, R5, R8
 * @rfc RFC-02 R3-R5
 * @rfc RFC-10 R12
 * @rfc RFC-22 R7
 * @rfc RFC-24 R4
 */
export function createApp(deps: AppDeps) {
  const ctx: AuthContext = {
    db: deps.db,
    sessions: deps.sessions,
    mfa: deps.mfa,
    limiter: deps.limiter,
    mailer: deps.mailer,
    breachChecker: deps.breachChecker,
    permissionCache: deps.permissionCache,
    logger: deps.logger,
    doi: deps.doi,
    appOrigin: deps.config.appOrigin,
    now: deps.now ?? Date.now,
  };
  // Request id, security headers, 404 and error handling sit on the root so
  // that a request outside /api (only the development port exposes any; Caddy
  // proxies /api/* alone) still gets them: RFC-11 R5 says every response.
  const root = new Hono<AppEnv>();
  root.use(requestId());
  root.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );
  root.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));
  root.onError(createErrorHandler(deps.logger));

  const app = root.basePath('/api');
  app.use(requestLogger(deps.logger));
  app.use(originCheck(deps.config.appOrigin));
  app.use(bodyLimit({ maxSize: BODY_LIMIT_BYTES }));
  app.use(resolveSession({ sessions: deps.sessions, db: deps.db }));
  app.use(globalRateLimit(deps.limiter));

  app.route('/health', healthRoutes(deps.health));
  app.route('/auth', authRoutes(ctx));
  app.route('/me', meRoutes(ctx));
  app.route('/admin', adminRoutes(ctx));
  app.route('/', datasetRoutes(ctx));

  return root;
}

export type App = ReturnType<typeof createApp>;
