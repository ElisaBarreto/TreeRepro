import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSpecies } from '../../../test/helpers/dataset.ts';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { speciesProposals } from './proposals.ts';

/** The SQLSTATE PostgreSQL raises for a violated CHECK constraint. */
const CHECK_VIOLATION = '23514';
/** The SQLSTATE PostgreSQL raises for a violated UNIQUE constraint. */
const UNIQUE_VIOLATION = '23505';

const tag = () => randomBytes(4).toString('hex');

describe('RFC-75 R1 species_proposals', () => {
  const t = useTestDb();

  it('defaults a new row to open with a null decided_at and a null species_id', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const [row] = await tx
        .insert(speciesProposals)
        .values({ proposedName: `Testus propositus-${tag()}`, proposerId: user.id })
        .returning();
      expect(row).toMatchObject({ status: 'open', decidedAt: null, speciesId: null });
      expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('species_proposals_open_check: an open proposal needs a null decided_at', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sub) =>
            sub.insert(speciesProposals).values({
              proposedName: `Testus apertus-${tag()}`,
              proposerId: user.id,
              status: 'open',
              decidedAt: new Date(),
            }),
          ),
        ),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint_name: 'species_proposals_open_check',
      });
    });
  });

  it('species_proposals_open_check: a decided proposal (rejected) needs a non-null decided_at', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sub) =>
            sub.insert(speciesProposals).values({
              proposedName: `Testus decisus-${tag()}`,
              proposerId: user.id,
              status: 'rejected',
              decidedAt: null,
              decisionNote: 'not a real species',
            }),
          ),
        ),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint_name: 'species_proposals_open_check',
      });
    });
  });

  it('species_proposals_approved_check: an approved proposal needs a non-null species_id', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sub) =>
            sub.insert(speciesProposals).values({
              proposedName: `Testus approbatus-${tag()}`,
              proposerId: user.id,
              status: 'approved',
              decidedAt: new Date(),
              decidedBy: user.id,
              speciesId: null,
            }),
          ),
        ),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint_name: 'species_proposals_approved_check',
      });
    });
  });

  it('species_proposals_approved_check is an equivalence: both satisfying halves pass', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const sp = await createSpecies(tx);
      const [approved] = await tx
        .insert(speciesProposals)
        .values({
          proposedName: `Testus confirmatus-${tag()}`,
          proposerId: user.id,
          status: 'approved',
          decidedAt: new Date(),
          decidedBy: user.id,
          speciesId: sp.id,
        })
        .returning();
      expect(approved).toMatchObject({ status: 'approved', speciesId: sp.id });

      const [rejected] = await tx
        .insert(speciesProposals)
        .values({
          proposedName: `Testus reiectus-${tag()}`,
          proposerId: user.id,
          status: 'rejected',
          decidedAt: new Date(),
          decidedBy: user.id,
          decisionNote: 'duplicate',
        })
        .returning();
      expect(rejected).toMatchObject({ status: 'rejected', speciesId: null });
    });
  });

  it('species_proposals_open_name_idx: a second open proposal for the same name (case-insensitive) is rejected (23505)', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const name = `Testus casus-${tag()}`;
      await tx.insert(speciesProposals).values({ proposedName: name, proposerId: user.id });
      await expect(
        unwrapDbError(
          tx.transaction((sub) =>
            sub.insert(speciesProposals).values({
              proposedName: name.toUpperCase(),
              proposerId: user.id,
            }),
          ),
        ),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint_name: 'species_proposals_open_name_idx',
      });
    });
  });

  it('species_proposals_open_name_idx does not block a second open proposal for a different name', async () => {
    await withRollback(t.db, async (tx) => {
      const { user } = await createUser(tx);
      const [first] = await tx
        .insert(speciesProposals)
        .values({ proposedName: `Testus primus-${tag()}`, proposerId: user.id })
        .returning();
      const [second] = await tx
        .insert(speciesProposals)
        .values({ proposedName: `Testus secundus-${tag()}`, proposerId: user.id })
        .returning();
      expect(first?.status).toBe('open');
      expect(second?.status).toBe('open');
    });
  });
});
