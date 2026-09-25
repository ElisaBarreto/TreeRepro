import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSpecies } from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { randomIsbn } from '../../test/helpers/isbn.ts';
import { createUser } from '../../test/helpers/users.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { speciesNames } from '../db/schema/taxa.ts';
import { addSpeciesName, createReference, updateReference } from './catalog.ts';

const tag = () => randomBytes(4).toString('hex');

describe('RFC-60 R9 addSpeciesName persists the name type, language and source', () => {
  const t = useTestDb();

  const namesOf = (speciesId: string) =>
    t.db
      .select({
        name: speciesNames.name,
        nameType: speciesNames.nameType,
        language: speciesNames.language,
        source: speciesNames.source,
        gbifUsageKey: speciesNames.gbifUsageKey,
      })
      .from(speciesNames)
      .where(eq(speciesNames.speciesId, speciesId));

  it('stores a common name with its language and the given source', async () => {
    const { user } = await createUser(t.db);
    const sp = await createSpecies(t.db);
    const name = `Pau-brasil-${tag()}`;
    await addSpeciesName(t.db, {
      speciesId: sp.id,
      name,
      nameType: 'common',
      language: 'pt',
      source: 'Flora e Funga do Brasil',
      actorId: user.id,
    });
    expect(await namesOf(sp.id)).toEqual([
      {
        name,
        nameType: 'common',
        language: 'pt',
        source: 'Flora e Funga do Brasil',
        gbifUsageKey: null,
      },
    ]);
  });

  it("source defaults to 'manual' when the body omits it, unlike the column default", async () => {
    const { user } = await createUser(t.db);
    const sp = await createSpecies(t.db);
    const name = `Synonymus ${tag()}`;
    await addSpeciesName(t.db, {
      speciesId: sp.id,
      name,
      nameType: 'synonym',
      actorId: user.id,
    });
    expect(await namesOf(sp.id)).toEqual([
      { name, nameType: 'synonym', language: null, source: 'manual', gbifUsageKey: null },
    ]);
  });

  it('keeps the gbif usage key on a gbif name', async () => {
    const { user } = await createUser(t.db);
    const sp = await createSpecies(t.db);
    const name = `Gbifus ${tag()}`;
    await addSpeciesName(t.db, {
      speciesId: sp.id,
      name,
      nameType: 'gbif',
      gbifUsageKey: `key-${tag()}`,
      actorId: user.id,
    });
    const [row] = await namesOf(sp.id);
    expect(row).toMatchObject({ nameType: 'gbif', language: null, source: 'manual' });
    expect(row?.gbifUsageKey).toMatch(/^key-/);
  });
});

describe('RFC-61 R6 references carry a short and a full citation', () => {
  const t = useTestDb();

  const rowOf = async (id: string) =>
    (
      await t.db
        .select({
          shortCitation: bibliographicReferences.shortCitation,
          fullCitation: bibliographicReferences.fullCitation,
        })
        .from(bibliographicReferences)
        .where(eq(bibliographicReferences.id, id))
    )[0];

  it('createReference persists both citations', async () => {
    const { user } = await createUser(t.db);
    const key = `Cite_${tag()}`;
    const created = await createReference(t.db, {
      citationKey: key,
      shortCitation: `Barreto (2026) ${key}`,
      fullCitation: `Barreto, E. (2026). A title. A journal. https://doi.org/10.1234/${key}`,
      actorId: user.id,
    });
    expect(await rowOf(created.id)).toEqual({
      shortCitation: `Barreto (2026) ${key}`,
      fullCitation: `Barreto, E. (2026). A title. A journal. https://doi.org/10.1234/${key}`,
    });
  });

  it('createReference leaves both citations null when they are not given', async () => {
    const { user } = await createUser(t.db);
    const created = await createReference(t.db, {
      citationKey: `Bare_${tag()}`,
      actorId: user.id,
    });
    expect(await rowOf(created.id)).toEqual({ shortCitation: null, fullCitation: null });
  });

  it('updateReference persists the citations and audits them by name', async () => {
    const { user } = await createUser(t.db);
    const created = await createReference(t.db, {
      citationKey: `Upd_${tag()}`,
      shortCitation: 'Old (2000)',
      actorId: user.id,
    });
    await updateReference(t.db, {
      id: created.id,
      shortCitation: 'New (2026)',
      fullCitation: 'New, A. (2026). Another title.',
      actorId: user.id,
    });
    expect(await rowOf(created.id)).toEqual({
      shortCitation: 'New (2026)',
      fullCitation: 'New, A. (2026). Another title.',
    });
    const audits = await t.db
      .select({ action: auditLog.action, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.targetId, created.id));
    const updates = audits.filter((a) => a.action === 'references.updated');
    expect(updates).toHaveLength(1);
    const metadata = updates[0]?.metadata as { fields: string[] } | undefined;
    expect(metadata?.fields).toEqual(['shortCitation', 'fullCitation']);
  });

  it('updateReference audits only the field that actually changed, by name', async () => {
    const { user } = await createUser(t.db);
    const created = await createReference(t.db, {
      citationKey: `Solo_${tag()}`,
      shortCitation: 'Old (2000)',
      fullCitation: 'Old, A. (2000). A title.',
      actorId: user.id,
    });
    await updateReference(t.db, {
      id: created.id,
      shortCitation: 'New (2026)',
      actorId: user.id,
    });
    expect(await rowOf(created.id)).toEqual({
      shortCitation: 'New (2026)',
      fullCitation: 'Old, A. (2000). A title.',
    });
    const audits = await t.db
      .select({ action: auditLog.action, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.targetId, created.id));
    const updates = audits.filter((a) => a.action === 'references.updated');
    expect(updates).toHaveLength(1);
    expect((updates[0]?.metadata as { fields: string[] } | undefined)?.fields).toEqual([
      'shortCitation',
    ]);
  });

  it('updateReference records nothing when a citation equals the stored value', async () => {
    const { user } = await createUser(t.db);
    const created = await createReference(t.db, {
      citationKey: `Same_${tag()}`,
      shortCitation: 'Same (2026)',
      actorId: user.id,
    });
    await updateReference(t.db, {
      id: created.id,
      shortCitation: 'Same (2026)',
      actorId: user.id,
    });
    const audits = await t.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.targetId, created.id));
    expect(audits.filter((a) => a.action === 'references.updated')).toHaveLength(0);
  });
});

describe('RFC-61 R6, R10 a curator writes a book by its ISBN', () => {
  const t = useTestDb();

  it('an ISBN on create makes a book, normalised, and needs the full citation', async () => {
    const { user } = await createUser(t.db);
    await expect(
      createReference(t.db, { citationKey: `B_${tag()}`, isbn: randomIsbn(), actorId: user.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'fullCitation' }] });
    const isbn = randomIsbn();
    const created = await createReference(t.db, {
      citationKey: `B_${tag()}`,
      isbn: `${isbn.slice(0, 3)}-${isbn.slice(3)}`,
      fullCitation: 'Doe (2001). Seeds.',
      actorId: user.id,
    });
    expect(created).toMatchObject({ kind: 'book', isbn });
    await expect(
      createReference(t.db, {
        citationKey: `B_${tag()}`,
        isbn,
        fullCitation: 'Another',
        actorId: user.id,
      }),
    ).rejects.toMatchObject({ code: 'REFERENCE_ISBN_TAKEN' });
  });

  it('an ISBN on update is taken by a book only, and stays unique', async () => {
    const { user } = await createUser(t.db);
    const publication = await createReference(t.db, {
      citationKey: `P_${tag()}`,
      actorId: user.id,
    });
    await expect(
      updateReference(t.db, { id: publication.id, isbn: randomIsbn(), actorId: user.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'isbn' }] });
    const [a, b] = [randomIsbn(), randomIsbn()];
    const book = await createReference(t.db, {
      citationKey: `B_${tag()}`,
      isbn: a,
      fullCitation: 'Doe (2001).',
      actorId: user.id,
    });
    await createReference(t.db, {
      citationKey: `B_${tag()}`,
      isbn: b,
      fullCitation: 'Roe (2002).',
      actorId: user.id,
    });
    await expect(
      updateReference(t.db, { id: book.id, isbn: b, actorId: user.id }),
    ).rejects.toMatchObject({ code: 'REFERENCE_ISBN_TAKEN' });
    const fixed = await updateReference(t.db, {
      id: book.id,
      isbn: randomIsbn(),
      actorId: user.id,
    });
    expect(fixed.isbn).not.toBe(a);
  });
});
