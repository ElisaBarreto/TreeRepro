import { describe, expect, it } from 'vitest';
import {
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { AppError } from '../http/errors.ts';
import { annotateRecord, currentAccepted, setAccepted } from './curation.ts';
import { getRecord } from './records.ts';

/** Swallows the `AppError` the losing side of the race legitimately throws once the other side has committed. */
async function settled(p: Promise<unknown>, expectedCodes: string[]): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (!(err instanceof AppError) || !expectedCodes.includes(err.code)) throw err;
  }
}

describe('RFC-65 R4, R6 the withdraw-vs-accept race is serialised by an advisory lock', () => {
  const t = useTestDb();

  it('never leaves an accepted value pointing at a withdrawn record', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    for (let i = 0; i < 10; i++) {
      // A fresh species per iteration: the claim-key unique index would
      // otherwise reject the second iteration's identical record.
      const sp1 = await createSpecies(t.db);
      const rec = await createRecord(t.db, {
        speciesId: sp1.id,
        traitId: trait.id,
        valueText: 'a',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      await Promise.all([
        settled(
          setAccepted(t.db, {
            speciesId: sp1.id,
            traitId: trait.id,
            actorId: user.id,
            decision: 'accepted',
            recordId: rec.id,
          }),
          ['RECORD_WITHDRAWN'],
        ),
        settled(
          annotateRecord(t.db, {
            recordId: rec.id,
            actorId: user.id,
            kind: 'withdraw',
            note: 'Race',
            canWithdrawAny: false,
          }),
          ['RECORD_IS_ACCEPTED'],
        ),
      ]);
      const review = (await getRecord(t.db, rec.id))?.review;
      const current = await currentAccepted(t.db, sp1.id, trait.id);
      expect(
        review === 'withdrawn' && current?.recordId === rec.id,
        `iteration ${i}: review=${review}, current.recordId=${current?.recordId}`,
      ).toBe(false);
    }
  });
});
