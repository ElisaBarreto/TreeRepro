import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import type { Db } from '../../src/db/client.ts';
import { type AuditLogRow, auditLog } from '../../src/db/schema/audit-log.ts';

export interface AuditScope {
  /** The user who acted. `null` matches anonymous entries but is not a scope on its own. */
  actorUserId?: string | null;
  /** The entity acted upon (user id, role id, …). */
  targetId?: string;
  /** The request IP this test chose (`call(app, …, { ip })`); the way to find entries with no user. */
  ip?: string;
}

// Page size when matching by IP: the column is encrypted at rest (RFC-40), so
// the match happens after decryption, in memory, newest page first.
const IP_PAGE_SIZE = 200;

/**
 * Newest audit entry for `action` written on behalf of THIS test.
 *
 * Every integration file shares one database and Vitest runs files in
 * parallel, so "the newest row for this action" can belong to another test
 * (RFC-01 R4). The scope must therefore name something only this test knows:
 * a user it created, a target it acted on, or the IP it sent the request from.
 */
export async function lastAudit(
  db: Db,
  action: string,
  scope: AuditScope,
): Promise<AuditLogRow | undefined> {
  const scoped =
    scope.targetId !== undefined ||
    scope.ip !== undefined ||
    (scope.actorUserId !== undefined && scope.actorUserId !== null);
  if (!scoped) {
    throw new Error('lastAudit: scope by an actorUserId, a targetId or the request ip');
  }
  const conditions = [eq(auditLog.action, action)];
  if (scope.actorUserId === null) conditions.push(isNull(auditLog.actorUserId));
  else if (scope.actorUserId !== undefined) {
    conditions.push(eq(auditLog.actorUserId, scope.actorUserId));
  }
  if (scope.targetId !== undefined) conditions.push(eq(auditLog.targetId, scope.targetId));

  const page = (before?: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(...conditions, before === undefined ? undefined : lt(auditLog.id, before)))
      .orderBy(desc(auditLog.id))
      .limit(scope.ip === undefined ? 1 : IP_PAGE_SIZE);

  if (scope.ip === undefined) return (await page())[0];
  let before: string | undefined;
  for (;;) {
    const rows = await page(before);
    const match = rows.find((row) => row.ip === scope.ip);
    if (match || rows.length < IP_PAGE_SIZE) return match;
    before = rows[rows.length - 1]?.id;
  }
}
