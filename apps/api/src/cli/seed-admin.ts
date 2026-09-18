// `pnpm seed:admin --email <email> --name <name>` — invites the first user
// and assigns the `admin` role (RFC-20 R8, RFC-31 R9). Runs `inviteUser`
// with a null actor and prints the invitation link to stdout in addition to
// sending the email, so the flow works without a mailbox; the role is
// assigned whether or not the email send succeeds. Exit codes: 0 sent, 1
// invitation exists but the email failed (or any other error), 2 usage.
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { createPermissionCache } from '../access/permissions.ts';
import { setUserRoles } from '../access/roles.ts';
import { createHibpChecker } from '../auth/breach-check.ts';
import type { AuthContext } from '../auth/context.ts';
import { InvitationMailError, inviteUser } from '../auth/flows/invitation.ts';
import { createMfaStore } from '../auth/mfa.ts';
import { createRateLimiter } from '../auth/rate-limit.ts';
import { createSessionStore } from '../auth/sessions.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { ADMIN_ROLE_NAME, roles } from '../db/schema/roles.ts';
import { createDoiClient } from '../integrations/doi.ts';
import { createLogger } from '../logger.ts';
import { createMailer, createSmtpTransport } from '../mail/mailer.ts';
import { createRedis } from '../redis/client.ts';
import { configurePii } from '../security/pii.ts';
import { APP_VERSION } from '../version.ts';

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
  redis,
  sessions: createSessionStore(redis, sessionSecret),
  mfa: createMfaStore(redis, sessionSecret),
  limiter: createRateLimiter(redis),
  mailer: createMailer(createSmtpTransport(config.smtp), config.smtp.from),
  breachChecker: createHibpChecker({ logger }),
  permissionCache: createPermissionCache(redis),
  logger,
  doi: createDoiClient({ contactEmail: config.doiContactEmail, version: APP_VERSION }),
  appOrigin: config.appOrigin,
  now: Date.now,
};

async function assignAdmin(userId: string): Promise<void> {
  const [admin] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, ADMIN_ROLE_NAME))
    .limit(1);
  if (!admin) throw new Error('admin role missing: run the migrations first');
  await setUserRoles(ctx, { userId, roleIds: [admin.id], actorUserId: null });
}

let exitCode = 0;
try {
  const { user, link, expiresAt } = await inviteUser(ctx, {
    email: values.email,
    name: values.name,
    actorUserId: null,
  });
  await assignAdmin(user.id);
  process.stdout.write(
    `Invitation sent to ${values.email}.\nLink (expires ${expiresAt.toISOString()}): ${link}\nRole admin assigned.\n`,
  );
} catch (err) {
  if (err instanceof InvitationMailError) {
    process.stderr.write(
      `Invitation email could not be sent (${(err.cause as Error)?.message ?? 'unknown error'}).\n`,
    );
    process.stdout.write(
      `Hand this link to the user (expires ${err.expiresAt.toISOString()}): ${err.link}\n`,
    );
    await assignAdmin(err.user.id);
    process.stdout.write('Role admin assigned.\n');
    exitCode = 1;
  } else {
    process.stderr.write(`${(err as Error).message}\n`);
    exitCode = 1;
  }
} finally {
  await Promise.allSettled([close(), redis.quit()]);
}
process.exit(exitCode);
