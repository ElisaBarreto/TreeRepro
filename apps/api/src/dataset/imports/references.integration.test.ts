import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createReference } from '../../../test/helpers/dataset.ts';
import { useTestDb } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { auditLog } from '../../db/schema/audit-log.ts';
import { importRejects } from '../../db/schema/imports.ts';
import { bibliographicReferences } from '../../db/schema/references.ts';
import { importReferences } from './references.ts';

async function csv(lines: string[], eol = '\n'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'references-import-'));
  const file = join(dir, 'import.csv');
  await writeFile(file, `${lines.join(eol)}${eol}`);
  return file;
}

async function referenceRow(db: Parameters<typeof createReference>[0], id: string) {
  const [row] = await db
    .select()
    .from(bibliographicReferences)
    .where(eq(bibliographicReferences.id, id));
  if (!row) throw new Error('referenceRow: no row');
  return row;
}

describe('RFC-68 R13 import:references', () => {
  const t = useTestDb();

  it('a reference with all four fields null gets all four filled (inserted)', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `${ref.citationKey},Short cite,Full cite,10.1234/abc,https://example.test/a`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect(batch.kind).toBe('references');
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      1, 1, 0, 0,
    ]);
    const row = await referenceRow(t.db, ref.id);
    expect(row.shortCitation).toBe('Short cite');
    expect(row.fullCitation).toBe('Full cite');
    expect(row.doi).toBe('10.1234/abc');
    expect(row.url).toBe('https://example.test/a');
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.targetId, batch.id));
    expect(entry?.action).toBe('imports.completed');
    expect(entry?.metadata).toMatchObject({ kind: 'references', rowsInserted: 1 });
  });

  it('a second run of the same file is duplicate: fill-only-when-null never overwrites', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `${ref.citationKey},Short cite,Full cite,10.1234/xyz,https://example.test/b`,
    ]);
    await importReferences(t.db, { filePath: file, runBy: user.id });
    const again = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect([again.rowsTotal, again.rowsInserted, again.rowsDuplicate, again.rowsRejected]).toEqual([
      1, 0, 1, 0,
    ]);
    const row = await referenceRow(t.db, ref.id);
    expect(row.doi).toBe('10.1234/xyz');
  });

  it('a reference that already has a doi keeps it and fills only url (still inserted)', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db, { doi: `10.5555/already-${Date.now()}` });
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `${ref.citationKey},,,${ref.doi},https://example.test/c`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      1, 1, 0, 0,
    ]);
    const row = await referenceRow(t.db, ref.id);
    expect(row.doi).toBe(ref.doi);
    expect(row.url).toBe('https://example.test/c');
    expect(row.shortCitation).toBeNull();
    expect(row.fullCitation).toBeNull();
  });

  it('a doi already held by a different reference is rejected doi_taken (agrees with the lower(doi) unique index)', async () => {
    const { user } = await createUser(t.db);
    const taken = `10.6000/taken-${Date.now()}`;
    await createReference(t.db, { doi: taken });
    const target = await createReference(t.db);
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      // uppercase variant of an already-held doi: case-insensitive match against lower(doi)
      `${target.citationKey},,,${taken.toUpperCase()},`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      1, 0, 0, 1,
    ]);
    const [reject] = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(reject?.reason).toBe('doi_taken');
    const row = await referenceRow(t.db, target.id);
    expect(row.doi).toBeNull();
  });

  it('two rows in the same file claiming the same new doi for different references: the earlier row wins by row_no, the later is doi_taken, and the batch completes rather than erroring (23505 guard)', async () => {
    const { user } = await createUser(t.db);
    const first = await createReference(t.db);
    const second = await createReference(t.db);
    const contested = `10.7000/contested-${Date.now()}`;
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `${first.citationKey},,,${contested},`,
      `${second.citationKey},,,${contested},`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect(batch.status).toBe('completed');
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      2, 1, 0, 1,
    ]);
    const [reject] = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(reject?.reason).toBe('doi_taken');
    expect((reject?.rawRow as { reference_key?: string })?.reference_key).toBe(second.citationKey);
    const firstRow = await referenceRow(t.db, first.id);
    const secondRow = await referenceRow(t.db, second.id);
    expect(firstRow.doi).toBe(contested);
    expect(secondRow.doi).toBeNull();
  });

  it('a malformed doi is rejected invalid_value (RFC-80 R1)', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `${ref.citationKey},,,not-a-doi,`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      1, 0, 0, 1,
    ]);
    const [reject] = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(reject?.reason).toBe('invalid_value');
    const row = await referenceRow(t.db, ref.id);
    expect(row.doi).toBeNull();
  });

  it('an unknown citation key is rejected unknown_reference', async () => {
    const { user } = await createUser(t.db);
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `No_such_key_${Date.now()},Short,Full,,`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      1, 0, 0, 1,
    ]);
    const [reject] = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(reject?.reason).toBe('unknown_reference');
  });

  it('DOIs are normalised before storage: 10.1111/GEB.1 becomes 10.1111/geb.1 (RFC-80 R1)', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `${ref.citationKey},,,10.1111/GEB.1,`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect(batch.rowsInserted).toBe(1);
    const row = await referenceRow(t.db, ref.id);
    expect(row.doi).toBe('10.1111/geb.1');
  });

  it('a repeated key whose earlier row is malformed and whose last row is valid: the last row applies, the earlier row is duplicate, not rejected (RFC-68 R4)', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `${ref.citationKey},,,not-a-doi,`,
      `${ref.citationKey},,,10.8000/last-wins-${Date.now()},`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      2, 1, 1, 0,
    ]);
    const rejects = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(rejects).toHaveLength(0);
    const row = await referenceRow(t.db, ref.id);
    expect(row.doi).toMatch(/^10\.8000\/last-wins-/);
  });

  it('a repeated key whose last row is malformed: the key contributes nothing, the last row is rejected with its own reason, the earlier row is duplicate and never applied (RFC-68 R4)', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `${ref.citationKey},,,10.8100/earlier-loses-${Date.now()},`,
      `${ref.citationKey},,,not-a-doi,`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      2, 0, 1, 1,
    ]);
    const [reject] = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(reject?.reason).toBe('invalid_value');
    const row = await referenceRow(t.db, ref.id);
    expect(row.doi).toBeNull();
  });

  it('a repeated key where both rows are valid: the last row wins, the earlier row is duplicate (RFC-68 R4)', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const winningDoi = `10.8200/second-wins-${Date.now()}`;
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      `${ref.citationKey},,,10.8200/first-loses-${Date.now()},`,
      `${ref.citationKey},,,${winningDoi},`,
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      2, 1, 1, 0,
    ]);
    const row = await referenceRow(t.db, ref.id);
    expect(row.doi).toBe(winningDoi);
  });

  it('two blank reference keys are not a repeated key: each is rejected unknown_reference on its own row, never folded into duplicate (RFC-68 R4)', async () => {
    const { user } = await createUser(t.db);
    const file = await csv([
      'reference_key,short_citation,full_citation,doi,url',
      ',Blank one,,,',
      '   ,Blank two (whitespace-only),,,',
    ]);
    const batch = await importReferences(t.db, { filePath: file, runBy: user.id });
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      2, 0, 0, 2,
    ]);
    expect(batch.rowsInserted + batch.rowsDuplicate + batch.rowsRejected).toBe(batch.rowsTotal);
    const rejects = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(rejects.map((r) => r.reason)).toEqual(['unknown_reference', 'unknown_reference']);
  });

  it('refuses a wrong header before creating a batch', async () => {
    const bad = await csv(['citation_key,short_citation', 'x,y']);
    await expect(importReferences(t.db, { filePath: bad, runBy: null })).rejects.toThrow(/header/i);
  });
});
