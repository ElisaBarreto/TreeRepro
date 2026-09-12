import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createHibpChecker } from './auth/breach-check.ts';
import { createMfaStore } from './auth/mfa.ts';
import { createRateLimiter } from './auth/rate-limit.ts';
import { createSessionStore } from './auth/sessions.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { createHealthChecks } from './http/health-checks.ts';
import { createLogger } from './logger.ts';
import { createMailer, createSmtpTransport } from './mail/mailer.ts';
import { createRedis } from './redis/client.ts';
import { configurePii } from './security/pii.ts';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
configurePii(config.pii.keyring.expose(), config.pii.hmacKey.expose());

const { db, close: closeDb } = createDb(config.db.url.expose());
const redis = createRedis(config.redis.url.expose());
// Without a listener ioredis prints "[ioredis] Unhandled error event" to
// stderr, bypassing pino and its redaction (RFC-02 R7).
redis.on('error', (err) => logger.error({ err }, 'redis error'));
await redis.connect();

const sessionSecret = config.sessionSecret.expose();
const sessions = createSessionStore(redis, sessionSecret);
const mfa = createMfaStore(redis, sessionSecret);
const limiter = createRateLimiter(redis);
const mailer = createMailer(createSmtpTransport(config.smtp), config.smtp.from);
const breachChecker = createHibpChecker({ logger });

const app = createApp({
  config,
  logger,
  health: createHealthChecks(db, redis),
  db,
  sessions,
  mfa,
  limiter,
  mailer,
  breachChecker,
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  logger.info({ port: info.port, env: config.nodeEnv }, 'api listening');
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    Promise.allSettled([closeDb(), redis.quit()]).then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
