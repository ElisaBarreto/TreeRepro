// `pnpm seed:admin --email <email> --name <name>` — invites the first user
// (RFC-20 R8). Runs `inviteUser` with a null actor and prints the invitation
// link to stdout in addition to sending the email, so the flow works without
// a mailbox. Exit codes: 0 sent, 1 invitation exists but the email failed (or
// any other error), 2 usage.
import { parseArgs } from 'node:util';
import { createPermissionCache } from '../access/permissions.ts';
import { createHibpChecker } from '../auth/breach-check.ts';
import type { AuthContext } from '../auth/context.ts';
import { InvitationMailError, inviteUser } from '../auth/flows/invitation.ts';
import { createMfaStore } from '../auth/mfa.ts';
import { createRateLimiter } from '../auth/rate-limit.ts';
import { createSessionStore } from '../auth/sessions.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { createLogger } from '../logger.ts';
import { createMailer, createSmtpTransport } from '../mail/mailer.ts';
import { createRedis } from '../redis/client.ts';
import { configurePii } from '../security/pii.ts';

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
  strict: true,
});
if (!values.email || !values.name) {
  process.stderr.write('usage: seed-admin --email <email> --name <name>\n');
  process.exit(2);
}

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });
configurePii(config.pii.keyring.expose(), config.pii.hmacKey.expose());
const { db, close } = createDb(config.db.url.expose(), { max: 1 });
const redis = createRedis(config.redis.url.expose());
await redis.connect();
const sessionSecret = config.sessionSecret.expose();
const ctx: AuthContext = {
  db,
  sessions: createSessionStore(redis, sessionSecret),
  mfa: createMfaStore(redis, sessionSecret),
  limiter: createRateLimiter(redis),
  mailer: createMailer(createSmtpTransport(config.smtp), config.smtp.from),
  breachChecker: createHibpChecker({ logger }),
  permissionCache: createPermissionCache(redis),
  logger,
  appOrigin: config.appOrigin,
  now: Date.now,
};

let exitCode = 0;
try {
  const { link, expiresAt } = await inviteUser(ctx, {
    email: values.email,
    name: values.name,
    actorUserId: null,
  });
  process.stdout.write(
    `Invitation sent to ${values.email}.\nLink (expires ${expiresAt.toISOString()}): ${link}\n`,
  );
} catch (err) {
  if (err instanceof InvitationMailError) {
    process.stderr.write(
      `Invitation email could not be sent (${(err.cause as Error)?.message ?? 'unknown error'}).\n`,
    );
    process.stdout.write(
      `Hand this link to the user (expires ${err.expiresAt.toISOString()}): ${err.link}\n`,
    );
    exitCode = 1;
  } else {
    process.stderr.write(`${(err as Error).message}\n`);
    exitCode = 1;
  }
} finally {
  await Promise.allSettled([close(), redis.quit()]);
}
process.exit(exitCode);
