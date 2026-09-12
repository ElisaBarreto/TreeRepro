import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { createHealthChecks } from './http/health-checks.ts';
import { createLogger } from './logger.ts';
import { createRedis } from './redis/client.ts';
import { configurePii } from './security/pii.ts';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
configurePii(config.pii.keyring, config.pii.hmacKey);

const { db, close: closeDb } = createDb(config.db.url);
const redis = createRedis(config.redis.url);
// Without a listener ioredis prints "[ioredis] Unhandled error event" to
// stderr, bypassing pino and its redaction (RFC-02 R7).
redis.on('error', (err) => logger.error({ err }, 'redis error'));
await redis.connect();

const app = createApp({ config, logger, health: createHealthChecks(db, redis) });

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
