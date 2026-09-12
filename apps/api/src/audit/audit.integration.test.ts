import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { unwrapDbError, useTestDb, withRollback } from '../../test/helpers/db.ts';
import { TEST_KEYRING } from '../../test/helpers/pii.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { decryptPii } from '../security/pii.ts';
import { AuditActionError, AuditMetadataError, assertSafeMetadata, recordAudit } from './audit.ts';

describe('RFC-41 recordAudit', () => {
  const t = useTestDb();
  // Table owner-equivalent: holds every privilege, so only the trigger can stop it.
  const su = useTestDb({ role: 'superuser' });

  it('R1, R8 inserts a row with a uuid v7 id, a timestamp and a null actor', async () => {
    await withRollback(t.db, async (tx) => {
      const { id } = await recordAudit(tx, { actorUserId: null, action: 'auth.login.failure' });
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      const [row] = await tx.select().from(auditLog).where(eq(auditLog.id, id));
      expect(row?.action).toBe('auth.login.failure');
      expect(row?.actorUserId).toBeNull();
      expect(row?.at).toBeInstanceOf(Date);
      expect(row?.metadata).toEqual({});
      expect(row?.ip).toBeNull();
    });
  });

  it('R4 stores ip and user_agent encrypted and reads them back decrypted', async () => {
    await withRollback(t.db, async (tx) => {
      const { id } = await recordAudit(tx, {
        actorUserId: null,
        action: 'auth.login.success',
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      });
      const raw = await tx.execute(sql`select ip, user_agent from audit_log where id = ${id}`);
      const stored = raw[0] as { ip: string; user_agent: string };
      expect(stored.ip.startsWith('v1:')).toBe(true);
      expect(stored.ip).not.toContain('203.0.113.7');
      expect(decryptPii(TEST_KEYRING, stored.ip)).toBe('203.0.113.7');
      expect(decryptPii(TEST_KEYRING, stored.user_agent)).toBe('Mozilla/5.0');
      const [row] = await tx.select().from(auditLog).where(eq(auditLog.id, id));
      expect(row?.ip).toBe('203.0.113.7');
      expect(row?.userAgent).toBe('Mozilla/5.0');
    });
  });

  it('R2 trigger rejects UPDATE for a role that holds the privilege', async () => {
    await withRollback(su.db, async (tx) => {
      const { id } = await recordAudit(tx, { actorUserId: null, action: 'auth.logout' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.update(auditLog).set({ action: 'x' }).where(eq(auditLog.id, id)),
          ),
        ),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('R9 the app role is refused UPDATE by privilege, before the trigger runs', async () => {
    await withRollback(t.db, async (tx) => {
      const { id } = await recordAudit(tx, { actorUserId: null, action: 'auth.logout' });
      await expect(
        unwrapDbError(
          tx.transaction((sp) =>
            sp.update(auditLog).set({ action: 'x' }).where(eq(auditLog.id, id)),
          ),
        ),
      ).rejects.toThrow('permission denied for table audit_log');
    });
  });

  it('R2 rejects DELETE without the purge flag and allows it with SET LOCAL', async () => {
    await withRollback(t.db, async (tx) => {
      const { id } = await recordAudit(tx, { actorUserId: null, action: 'auth.logout' });
      await expect(
        unwrapDbError(tx.transaction((sp) => sp.delete(auditLog).where(eq(auditLog.id, id)))),
      ).rejects.toThrow(/append-only/);
      await tx.transaction(async (sp) => {
        await sp.execute(sql`set local treerepro.allow_audit_purge = 'on'`);
        await sp.delete(auditLog).where(eq(auditLog.id, id));
      });
      const rows = await tx.select().from(auditLog).where(eq(auditLog.id, id));
      expect(rows).toHaveLength(0);
    });
  });

  it('R2 trigger rejects TRUNCATE for a role that holds the privilege', async () => {
    await withRollback(su.db, async (tx) => {
      await expect(
        unwrapDbError(tx.transaction((sp) => sp.execute(sql`truncate audit_log`))),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('R9 the app role is refused TRUNCATE by privilege, before the trigger runs', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(
        unwrapDbError(tx.transaction((sp) => sp.execute(sql`truncate audit_log`))),
      ).rejects.toThrow('permission denied for table audit_log');
    });
  });

  it('R7 rejects forbidden metadata keys at any depth before writing', async () => {
    await withRollback(t.db, async (tx) => {
      const before = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLog);
      await expect(
        recordAudit(tx, {
          actorUserId: null,
          action: 'users.updated',
          metadata: { changes: [{ field: 'x' }, { nested: { email: 'a@b' } }] },
        }),
      ).rejects.toThrow(AuditMetadataError);
      const after = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLog);
      expect(after[0]?.n).toBe(before[0]?.n);
    });
  });

  it('R3 rejects actions outside the catalog', async () => {
    await withRollback(t.db, async (tx) => {
      await expect(
        recordAudit(tx, { actorUserId: null, action: 'nope.nothing' as never }),
      ).rejects.toThrow(AuditActionError);
    });
  });
});

describe('RFC-41 R7 assertSafeMetadata', () => {
  it('accepts safe values and names the offending path', () => {
    expect(() => assertSafeMetadata({ count: 1, list: ['a'], nested: { ok: true } })).not.toThrow();
    expect(() => assertSafeMetadata({ nested: { deeper: { token: 'x' } } })).toThrow(
      'metadata key "nested.deeper.token" is not allowed',
    );
    expect(() => assertSafeMetadata({ items: [{ password: 'x' }] })).toThrow(
      'metadata key "items.0.password" is not allowed',
    );
  });
});
