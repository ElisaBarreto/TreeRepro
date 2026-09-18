import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSpecies } from '../../../test/helpers/dataset.ts';
import { useTestDb } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { auditLog } from '../../db/schema/audit-log.ts';
import { importRejects } from '../../db/schema/imports.ts';
import { speciesNames } from '../../db/schema/taxa.ts';
import { importSynonyms } from './synonyms.ts';

async function csv(lines: string[], eol = '\n'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'synonyms-import-'));
  const file = join(dir, 'import.csv');
  await writeFile(file, `${lines.join(eol)}${eol}`);
  return file;
}

describe('RFC-68 R12 import:synonyms', () => {
  const t = useTestDb();

  it(
    'inserts a synonym and a common name, rejects a bad name_type and an unknown species, ' +
      'treats the canonical name and a repeat as duplicate, defaults an empty source to import, ' +
      'audits the batch (RFC-68 R12, RFC-60 R2, R4)',
    async () => {
      const { user } = await createUser(t.db);
      const sp = await createSpecies(t.db);
      const other = await createSpecies(t.db);
      const synonymName = `Synonymus testus-${Math.random().toString(36).slice(2)}`;
      const commonName = `common-name-pt-${Math.random().toString(36).slice(2)}`;
      const unknownName = `No such species-${Math.random().toString(36).slice(2)}`;

      const file = await csv([
        'wcvp_canonical_name,synonym_or_common_name,name_type,source',
        `${sp.canonicalName},${synonymName},synonym,WCVP`,
        `${sp.canonicalName},${commonName},common_pt,`,
        `${sp.canonicalName},Some other name,common_xx1,WCVP`,
        `${unknownName},Whatever,synonym,WCVP`,
        `${sp.canonicalName},${sp.canonicalName},synonym,WCVP`,
        `${sp.canonicalName},${synonymName},synonym,WCVP`,
      ]);

      const batch = await importSynonyms(t.db, { filePath: file, runBy: user.id });
      expect(batch.kind).toBe('synonyms');
      expect(batch.status).toBe('completed');
      // rule: rows_total = inserted + duplicate + rejected (RFC-68 R4) —
      // 6 rows: 2 inserted, 2 duplicate (canonical-name row + repeated synonym), 2 rejected
      expect([
        batch.rowsTotal,
        batch.rowsInserted,
        batch.rowsDuplicate,
        batch.rowsRejected,
      ]).toEqual([6, 2, 2, 2]);

      // rule: a synonym row is inserted with the file's source
      const [synonymRow] = await t.db
        .select()
        .from(speciesNames)
        .where(and(eq(speciesNames.speciesId, sp.id), eq(speciesNames.name, synonymName)));
      expect(synonymRow).toMatchObject({ nameType: 'synonym', language: null, source: 'WCVP' });

      // rule: common_pt inserts with language 'pt', and an empty source becomes 'import'
      const [commonRow] = await t.db
        .select()
        .from(speciesNames)
        .where(and(eq(speciesNames.speciesId, sp.id), eq(speciesNames.name, commonName)));
      expect(commonRow).toMatchObject({ nameType: 'common', language: 'pt', source: 'import' });

      // rule: name_type outside `synonym` / `common_<lang>` is invalid_value, and
      // an unknown species is unknown_species
      const rejects = await t.db
        .select()
        .from(importRejects)
        .where(eq(importRejects.batchId, batch.id));
      expect(rejects.map((r) => r.reason).sort()).toEqual(['invalid_value', 'unknown_species']);
      const badType = rejects.find((r) => r.reason === 'invalid_value');
      expect(badType?.rawRow.name_type).toBe('common_xx1');
      const badSpecies = rejects.find((r) => r.reason === 'unknown_species');
      expect(badSpecies?.rawRow.wcvp_canonical_name).toBe(unknownName);

      // rule: no name equal to the canonical name was stored for the species
      const canonicalAsName = await t.db
        .select()
        .from(speciesNames)
        .where(and(eq(speciesNames.speciesId, sp.id), eq(speciesNames.name, sp.canonicalName)));
      expect(canonicalAsName).toHaveLength(0);

      const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.targetId, batch.id));
      expect(entry?.action).toBe('imports.completed');
      expect(entry?.metadata).toMatchObject({ kind: 'synonyms', rowsInserted: 2 });
      expect(entry?.actorUserId).toBe(user.id);

      // unrelated species untouched, hygiene: only asserting on our own rows
      const otherNames = await t.db
        .select()
        .from(speciesNames)
        .where(eq(speciesNames.speciesId, other.id));
      expect(otherNames).toHaveLength(0);
    },
  );

  it('rule: the same synonym twice in one file counts as one insert and one duplicate, via on conflict do nothing', async () => {
    const { user } = await createUser(t.db);
    const sp = await createSpecies(t.db);
    const name = `Dup synonym-${Math.random().toString(36).slice(2)}`;
    const file = await csv([
      'wcvp_canonical_name,synonym_or_common_name,name_type,source',
      `${sp.canonicalName},${name},synonym,WCVP`,
      `${sp.canonicalName},${name},synonym,WCVP`,
    ]);
    const batch = await importSynonyms(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      2, 1, 1, 0,
    ]);
    const rows = await t.db
      .select()
      .from(speciesNames)
      .where(and(eq(speciesNames.speciesId, sp.id), eq(speciesNames.name, name)));
    expect(rows).toHaveLength(1);
  });

  it('rule: a name already stored for the species (any type) is a duplicate on re-import', async () => {
    const { user } = await createUser(t.db);
    const name = `Existing synonym-${Math.random().toString(36).slice(2)}`;
    const sp = await createSpecies(t.db, {
      names: [{ name, nameType: 'synonym', source: 'WCVP' }],
    });
    const file = await csv([
      'wcvp_canonical_name,synonym_or_common_name,name_type,source',
      `${sp.canonicalName},${name},synonym,WCVP`,
    ]);
    const batch = await importSynonyms(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      1, 0, 1, 0,
    ]);
  });

  it('refuses a wrong header before creating a batch', async () => {
    const bad = await csv(['species,name,type,source', 'x,y,synonym,z']);
    await expect(importSynonyms(t.db, { filePath: bad, runBy: null })).rejects.toThrow(/header/i);
  });
});
