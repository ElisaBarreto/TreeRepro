import { platformHealthSchema } from '@treerepro/contracts';
import { count, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { adminRoleId, systemRoleId } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { auditLog } from '../../../db/schema/audit-log.ts';

describe('RFC-52 R1, R2 GET /api/admin/health', () => {
  const t = useTestApp();

  it('answers the health payload to an admin and writes no audit entry', async () => {
    const admin = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    const cookie = (await loginAs(t, admin.user)).cookie;
    const entriesOf = async (): Promise<number> => {
      const [row] = await t.db
        .select({ n: count() })
        .from(auditLog)
        .where(eq(auditLog.actorUserId, admin.user.id));
      return row?.n ?? 0;
    };
    const before = await entriesOf();

    const res = await call(t.app, 'GET', '/api/admin/health', { cookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The schema is strict, so a stray key anywhere in the payload fails here.
    expect(() => platformHealthSchema.parse(body.data)).not.toThrow();

    // R2: the route emits no audit entry. Scoped to this test's own user, the
    // only writer of which is this test (RFC-01 R4).
    expect(await entriesOf()).toBe(before);
  });

  it('is 403 for a manager, who does not hold health.read', async () => {
    const manager = await createUser(t.db, { roles: [await systemRoleId(t.db, 'manager')] });
    const res = await call(t.app, 'GET', '/api/admin/health', {
      cookie: (await loginAs(t, manager.user)).cookie,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('PERMISSION_DENIED');
  });
});
