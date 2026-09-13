import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import {
  createAcceptedValue,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { createUser } from '../../test/helpers/users.ts';
import { createDb } from '../db/client.ts';
import { acceptedCsv } from './export.ts';

/** Rejects after `ms` if `promise` has not settled by then. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]);
}

describe('RFC-66 acceptedCsv connection safety', () => {
  let handle: ReturnType<typeof createDb> | undefined;

  afterAll(async () => {
    await handle?.close();
  });

  it('a client cancel during an in-flight batch fetch does not leak the pooled connection', async () => {
    handle = createDb(inject('databaseUrl'), { max: 1 });
    const { db } = handle;
    const trait = await createTrait(db, { levels: ['red'] });
    const ref = await createReference(db);
    const { user } = await createUser(db);
    for (let i = 0; i < 5; i++) {
      const sp = await createSpecies(db);
      const rec = await createRecord(db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'red',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
      await createAcceptedValue(db, {
        speciesId: sp.id,
        traitId: trait.id,
        recordId: rec.id,
        actorId: user.id,
      });
    }

    const reader = acceptedCsv(db, { batch: 2 }).getReader();
    await reader.read();
    // Do not await this read before cancelling: it races the in-flight batch
    // fetch that `reader.cancel()` must wait for (RFC-66; the CRITICAL finding).
    const pending = reader.read();
    await reader.cancel();
    await pending.catch(() => undefined);

    // With the bug, `cancel()` calls the cursor's `return()` while `next()`
    // is mid-fetch; the arriving batch then awaits a continuation nobody
    // resolves and the sole pooled connection (max: 1) never comes back.
    await expect(withTimeout(db.execute(sql`select 1`), 5000)).resolves.toBeDefined();
  });
});
