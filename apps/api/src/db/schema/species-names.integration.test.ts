import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSpecies } from '../../../test/helpers/dataset.ts';
import { unwrapDbError, useTestDb, withRollback } from '../../../test/helpers/db.ts';
import { speciesNames } from './taxa.ts';

const tag = () => randomBytes(4).toString('hex');

describe('RFC-60 R1 species_names name_type, language and free-text source', () => {
  const t = useTestDb();

  it('defaults a name to the gbif type and the gbif source, with no language', async () => {
    await withRollback(t.db, async (tx) => {
      const sp = await createSpecies(tx);
      const [row] = await tx
        .insert(speciesNames)
        .values({ speciesId: sp.id, name: `Gbifus nomen-${tag()}` })
        .returning();
      expect(row).toMatchObject({ nameType: 'gbif', source: 'gbif', language: null });
    });
  });

  it('species_names_language_check: a common name needs a language', async () => {
    await withRollback(t.db, async (tx) => {
      const sp = await createSpecies(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sub) =>
            sub
              .insert(speciesNames)
              .values({ speciesId: sp.id, name: `Coralwood-${tag()}`, nameType: 'common' }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('species_names_language_check is an equivalence: a non-common name takes no language', async () => {
    await withRollback(t.db, async (tx) => {
      const sp = await createSpecies(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sub) =>
            sub.insert(speciesNames).values({
              speciesId: sp.id,
              name: `Synonymus nomen-${tag()}`,
              nameType: 'synonym',
              language: 'pt',
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      // And the two satisfying halves both pass.
      const [common] = await tx
        .insert(speciesNames)
        .values({
          speciesId: sp.id,
          name: `Pau-brasil-${tag()}`,
          nameType: 'common',
          language: 'pt',
          source: 'Flora e Funga do Brasil',
        })
        .returning();
      expect(common).toMatchObject({ nameType: 'common', language: 'pt' });
      const [synonym] = await tx
        .insert(speciesNames)
        .values({ speciesId: sp.id, name: `Synonymus-${tag()}`, nameType: 'synonym' })
        .returning();
      expect(synonym).toMatchObject({ nameType: 'synonym', language: null });
    });
  });

  it('species_names_gbif_key_check: only a gbif name carries a usage key', async () => {
    await withRollback(t.db, async (tx) => {
      const sp = await createSpecies(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sub) =>
            sub.insert(speciesNames).values({
              speciesId: sp.id,
              name: `Synonymus keyed-${tag()}`,
              nameType: 'synonym',
              gbifUsageKey: '123456',
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const [keyed] = await tx
        .insert(speciesNames)
        .values({ speciesId: sp.id, name: `Gbifus keyed-${tag()}`, gbifUsageKey: '123456' })
        .returning();
      expect(keyed).toMatchObject({ nameType: 'gbif', gbifUsageKey: '123456' });
    });
  });

  it('species_names_type_check: an unknown name type is refused', async () => {
    await withRollback(t.db, async (tx) => {
      const sp = await createSpecies(tx);
      await expect(
        unwrapDbError(
          tx.transaction((sub) =>
            sub.insert(speciesNames).values({
              speciesId: sp.id,
              name: `Vernacular-${tag()}`,
              nameType: 'vernacular' as never,
            }),
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('source is free text naming the provider, no longer constrained to gbif', async () => {
    await withRollback(t.db, async (tx) => {
      const sp = await createSpecies(tx);
      const source = `https://doi.org/10.1234/wcvp-${tag()}`;
      await tx
        .insert(speciesNames)
        .values({ speciesId: sp.id, name: `Wcvpus nomen-${tag()}`, nameType: 'synonym', source });
      const rows = await tx
        .select({ source: speciesNames.source })
        .from(speciesNames)
        .where(eq(speciesNames.speciesId, sp.id));
      expect(rows.map((r) => r.source)).toEqual([source]);
    });
  });
});
