import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { AppConfig } from './config.ts';
import type { AppEnv } from './http/env.ts';
import { createErrorHandler, errorBody } from './http/errors.ts';
import { originCheck } from './http/origin-check.ts';
import { type HealthChecks, healthRoutes } from './http/routes/health.ts';
import type { Logger } from './logger.ts';

export interface AppDeps {
  config: Pick<AppConfig, 'appOrigin'>;
  logger: Logger;
  health: HealthChecks;
}

/** @rfc RFC-02 R4 */
export const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * @rfc RFC-11 R1, R5, R8
 * @rfc RFC-02 R3-R5
 * @rfc RFC-10 R12
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use(requestId());
  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );
  app.use(originCheck(deps.config.appOrigin));
  app.use(bodyLimit({ maxSize: BODY_LIMIT_BYTES }));

  app.route('/health', healthRoutes(deps.health));

  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));
  app.onError(createErrorHandler(deps.logger));
  return app;
}

export type App = ReturnType<typeof createApp>;
