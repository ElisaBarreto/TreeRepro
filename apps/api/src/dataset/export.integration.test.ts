import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import {
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from '../../test/helpers/dataset.ts';
import { createUser } from '../../test/helpers/users.ts';
import { UNRESTRICTED } from '../../test/helpers/visibility.ts';
import { createDb } from '../db/client.ts';
import { recordsCsv } from './export.ts';

/** Rejects after `ms` if `promise` has not settled by then. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]);
}

describe('RFC-33 R2 recordsCsv pending record visibility', () => {
  let handle: ReturnType<typeof createDb> | undefined;

  afterAll(async () => {
    await handle?.close();
  });

  /** Reads every `record_id` a stream yields, in order. */
  async function recordIds(stream: ReadableStream<Uint8Array>): Promise<string[]> {
    const text = await new Response(stream).text();
    const lines = text.split('\r\n');
    return lines.slice(1, -1).map((line) => line.split(',').at(-1) ?? '');
  }

  it('omits a non-harmonised record when includePending is false, includes it when true', async () => {
    handle = createDb(inject('databaseUrl'));
    const { db } = handle;
    const trait = await createTrait(db, { valueType: 'quantitative', unit: 'mm' });
    const ref = await createReference(db);
    const { user } = await createUser(db);
    const sp = await createSpecies(db);
    const pending = await createRecord(db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'not a number',
      harmonisation: 'not_numeric',
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: user.id,
    });

    const withoutPending = await recordIds(recordsCsv(db, UNRESTRICTED));
    expect(withoutPending).not.toContain(pending.id);

    const withPending = await recordIds(recordsCsv(db, UNRESTRICTED, { includePending: true }));
    expect(withPending).toContain(pending.id);
  });
});

describe('RFC-66 R5 recordsCsv connection safety', () => {
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
      await createRecord(db, {
        speciesId: sp.id,
        traitId: trait.id,
        valueText: 'red',
        levelId: trait.levels[0]?.id,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
      });
    }

    const reader = recordsCsv(db, UNRESTRICTED, { batch: 2 }).getReader();
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
