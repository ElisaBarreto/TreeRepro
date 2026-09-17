import { describe, expect, it } from 'vitest';
import {
  createAnnotation,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  createVisibilityFixture,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { AppError } from '../http/errors.ts';
import {
  annotateRecord,
  createRecord as createRecordService,
  currentAccepted,
  getAccepted,
  setAccepted,
} from './curation.ts';
import { listDisputed, pendingTraits } from './queues.ts';
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
          annotateRecord(t.db, UNRESTRICTED, {
            recordId: rec.id,
            actorId: user.id,
            kind: 'withdraw',
            note: 'Race',
            canWithdrawAny: false,
          }),
          ['RECORD_IS_ACCEPTED'],
        ),
      ]);
      const review = (await getRecord(t.db, UNRESTRICTED, rec.id))?.review;
      const current = await currentAccepted(t.db, sp1.id, trait.id);
      expect(
        review === 'withdrawn' && current?.recordId === rec.id,
        `iteration ${i}: review=${review}, current.recordId=${current?.recordId}`,
      ).toBe(false);
    }
  });
});

describe('RFC-65 R6 setAccepted clearing branch locks before deciding', () => {
  const t = useTestDb();

  it('five concurrent identical clears leave exactly one cleared row in the history', async () => {
    const { user } = await createUser(t.db);
    const trait = await createTrait(t.db, { levels: ['a'] });
    const ref = await createReference(t.db);
    const sp = await createSpecies(t.db);
    const rec = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'a',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await setAccepted(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      actorId: user.id,
      decision: 'accepted',
      recordId: rec.id,
    });
    await Promise.all(
      Array.from({ length: 5 }, () =>
        setAccepted(t.db, {
          speciesId: sp.id,
          traitId: trait.id,
          actorId: user.id,
          decision: 'cleared',
          note: 'Race',
        }),
      ),
    );
    const { history } = await getAccepted(t.db, sp.id, trait.id);
    expect(history.filter((h) => h.decision === 'cleared')).toHaveLength(1);
  });
});

describe('RFC-33 R5 createRecord and annotateRecord by viewer', () => {
  const t = useTestDb();

  it('treat a hidden species or a record on it as not found for a restricted viewer', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    await expect(
      createRecordService(t.db, RESTRICTED, {
        actorId: user.id,
        speciesId: f.hiddenSpecies.id,
        traitId: f.activeTrait.id,
        value: { levelId: f.activeTrait.levels[0]?.id as string },
        primaryReferenceId: f.reference.id,
      }),
    ).rejects.toMatchObject({ code: 'SPECIES_NOT_FOUND' });
    const created = await createRecordService(t.db, UNRESTRICTED, {
      actorId: user.id,
      speciesId: f.hiddenSpecies.id,
      traitId: f.activeTrait.id,
      value: { levelId: f.activeTrait.levels[0]?.id as string },
      primaryReferenceId: f.reference.id,
      rawValue: 'a second, distinct claim',
    });
    expect(created.speciesId).toBe(f.hiddenSpecies.id);
    await expect(
      annotateRecord(t.db, RESTRICTED, {
        recordId: f.onHiddenSpecies.id,
        actorId: user.id,
        kind: 'confirm',
        canWithdrawAny: false,
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });
});

describe('RFC-33 R3 queues by viewer', () => {
  const t = useTestDb();

  it('omits a pending trait and a disputed record on a hidden species from a restricted viewer', async () => {
    const { user } = await createUser(t.db);
    const f = await createVisibilityFixture(t.db, user.id);
    await createRecord(t.db, {
      speciesId: f.hiddenSpecies.id,
      traitId: f.activeTrait.id,
      valueText: 'unmapped',
      primaryReferenceId: f.reference.id,
      harmonisation: 'unknown_level',
      origin: 'manual',
      createdBy: user.id,
    });
    const restrictedTraits = await pendingTraits(t.db, RESTRICTED);
    expect(restrictedTraits.find((x) => x.trait.id === f.activeTrait.id)).toBeUndefined();
    const unrestrictedTraits = await pendingTraits(t.db, UNRESTRICTED);
    expect(unrestrictedTraits.find((x) => x.trait.id === f.activeTrait.id)).toMatchObject({
      count: 1,
    });

    const disputed = await createRecord(t.db, {
      speciesId: f.hiddenSpecies.id,
      traitId: f.activeTrait.id,
      valueText: 'one',
      levelId: f.activeTrait.levels[0]?.id,
      rawValue: 'a second, distinct claim',
      primaryReferenceId: f.reference.id,
      origin: 'manual',
      createdBy: user.id,
    });
    await createAnnotation(t.db, {
      recordId: disputed.id,
      actorId: user.id,
      kind: 'dispute',
      note: 'Disputed on a hidden species',
    });
    const restrictedDisputed = await listDisputed(t.db, RESTRICTED, { limit: 10 });
    expect(restrictedDisputed.data.map((r) => r.id)).not.toContain(disputed.id);
    const unrestrictedDisputed = await listDisputed(t.db, UNRESTRICTED, { limit: 10 });
    expect(unrestrictedDisputed.data.map((r) => r.id)).toContain(disputed.id);
  });
});
