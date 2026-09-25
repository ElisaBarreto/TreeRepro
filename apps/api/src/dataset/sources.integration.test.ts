import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createReference } from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { fakeDoiClient } from '../../test/helpers/doi.ts';
import { randomIsbn } from '../../test/helpers/isbn.ts';
import { createUser } from '../../test/helpers/users.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { bibliographicReferences } from '../db/schema/references.ts';
import { ensurePersonalObservation } from './references.ts';
import { resolveDoi, resolveSourceRef, resolveSources } from './sources.ts';

describe('RFC-61 R7, R8, RFC-80 R4, R5 sources resolution', () => {
  const t = useTestDb();

  it('ensurePersonalObservation twice for one user returns same id, one audit entry', async () => {
    const { user } = await createUser(t.db);
    const first = await ensurePersonalObservation(t.db, user.id);
    const second = await ensurePersonalObservation(t.db, user.id);
    expect(first.id).toBe(second.id);

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.targetId, first.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('references.created');
  });

  it('resolveSources handles personal observation and existing references', async () => {
    const { user } = await createUser(t.db);
    const ref = await createReference(t.db);
    const doi = fakeDoiClient();
    const ctx = { db: t.db, doi };

    const poIds = await resolveSources(ctx, user.id, { personalObservation: true });
    expect(poIds).toHaveLength(1);

    const existingIds = await resolveSources(ctx, user.id, { references: [{ id: ref.id }] });
    expect(existingIds).toEqual([ref.id]);

    await expect(
      resolveSources(ctx, user.id, { references: [{ id: ref.id }, { id: ref.id }] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sources.references.1.id' }],
    });
  });

  it('RFC-61 R7 refuses a personal observation named by id, whoever the observer is', async () => {
    const { user } = await createUser(t.db);
    const { user: other } = await createUser(t.db);
    const doi = fakeDoiClient();
    const ctx = { db: t.db, doi };
    const mine = await ensurePersonalObservation(t.db, user.id);
    const theirs = await ensurePersonalObservation(t.db, other.id);

    for (const id of [mine.id, theirs.id]) {
      await expect(resolveSources(ctx, user.id, { references: [{ id }] })).rejects.toMatchObject({
        code: 'REFERENCE_IS_PERSONAL',
        details: [{ path: 'sources.references.0.id' }],
      });
    }
  });

  it('RFC-80 R5 an id and the DOI of that same reference count once', async () => {
    const { user } = await createUser(t.db);
    const doiClient = fakeDoiClient();
    const ctx = { db: t.db, doi: doiClient };
    const doi = '10.3333/same';
    doiClient.known.set(doi, { title: 'Same', authors: null, year: null, journal: null });
    const [id] = await resolveSources(ctx, user.id, { references: [{ doi }] });

    await expect(
      resolveSources(ctx, user.id, { references: [{ id: id ?? '' }, { doi }] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sources.references.1.doi' }],
    });
  });

  it('resolveSources handles DOI lookup, creation, idempotency, and failures', async () => {
    const { user } = await createUser(t.db);
    const doiClient = fakeDoiClient();
    const ctx = { db: t.db, doi: doiClient };
    const doi = '10.1111/x';

    doiClient.known.set(doi, {
      title: 'Title X',
      authors: 'Author A',
      year: 2024,
      journal: 'Journal J',
    });

    // Resolves and creates reference
    const ids = await resolveSources(ctx, user.id, { references: [{ doi: '10.1111/X' }] });
    expect(ids).toHaveLength(1);
    const createdId = ids[0] ?? '';

    const [createdRef] = await t.db
      .select()
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, createdId));
    expect(createdRef).toMatchObject({
      citationKey: 'doi:10.1111/x',
      title: 'Title X',
      authors: 'Author A',
      year: 2024,
      journal: 'Journal J',
      doi: '10.1111/x',
      url: 'https://doi.org/10.1111/x',
    });

    // Calling again returns the same id without a second audit event
    const ids2 = await resolveSources(ctx, user.id, { references: [{ doi }] });
    expect(ids2).toEqual(ids);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.targetId, createdId));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({ source: 'doi' });

    // Unknown DOI fails with VALIDATION_FAILED
    await expect(
      resolveSources(ctx, user.id, { references: [{ doi: '10.1111/unknown' }] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sources.references.0.doi' }],
    });

    // Failing DOI client results in 502 DOI_LOOKUP_FAILED
    doiClient.failing = true;
    await expect(
      resolveSources(ctx, user.id, { references: [{ doi: '10.1111/fail' }] }),
    ).rejects.toMatchObject({
      code: 'DOI_LOOKUP_FAILED',
    });
    doiClient.failing = false;

    // Malformed DOI
    await expect(
      resolveSources(ctx, user.id, { references: [{ doi: 'not-a-doi' }] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sources.references.0.doi' }],
    });

    // Duplicate DOIs in single request
    await expect(
      resolveSources(ctx, user.id, {
        references: [{ doi: '10.1111/X' }, { doi: 'https://doi.org/10.1111/x' }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sources.references.1.doi' }],
    });
  });

  it('resolveDoi returns known, resolvable preview, not_found, or validation error', async () => {
    const { user } = await createUser(t.db);
    const doiClient = fakeDoiClient();
    const ctx = { db: t.db, doi: doiClient };
    const doi = '10.2222/y';

    // Malformed
    await expect(resolveDoi(ctx, 'invalid')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // Not found in registry or DB
    const notFound = await resolveDoi(ctx, doi);
    expect(notFound).toEqual({ status: 'not_found', reference: null });

    // Resolvable in registry
    doiClient.known.set(doi, {
      title: 'Preview Title',
      authors: 'Author B',
      year: 2025,
      journal: null,
    });
    const resolvable = await resolveDoi(ctx, doi);
    expect(resolvable).toEqual({
      status: 'resolvable',
      reference: null,
      preview: {
        title: 'Preview Title',
        authors: 'Author B',
        year: 2025,
        journal: null,
      },
    });

    // Once created in DB, returns status: 'known'
    await resolveSources(ctx, user.id, { references: [{ doi }] });
    const known = await resolveDoi(ctx, doi);
    expect(known.status).toBe('known');
    expect((known as { reference: { citationKey: string } }).reference.citationKey).toBe(
      'doi:10.2222/y',
    );
  });

  it('RFC-61 R10 a book is one reference per ISBN, whether given as ISBN-10 or ISBN-13', async () => {
    const { user } = await createUser(t.db);
    const ctx = { db: t.db, doi: fakeDoiClient() };
    const citation = 'Doe, J. (2001). Seeds of the tropics. Tropical Press.';
    // A fixed pair (the one book this file names by hand), so the ISBN-10
    // form can be written out; every other test uses randomIsbn().
    const [id] = await resolveSources(ctx, user.id, {
      references: [{ isbn: '0-306-40615-2', citation }],
    });
    const byId = eq(bibliographicReferences.id, id ?? '');
    const [row] = await t.db.select().from(bibliographicReferences).where(byId);
    expect(row).toMatchObject({
      kind: 'book',
      isbn: '9780306406157',
      citationKey: 'isbn:9780306406157',
      fullCitation: citation,
      shortCitation: citation,
      doi: null,
      title: null,
      createdBy: user.id,
    });
    // Again, as the ISBN-13 and with another citation: the same reference,
    // its citation untouched, no second audit entry.
    expect(
      await resolveSources(ctx, user.id, {
        references: [{ isbn: '978-0-306-40615-7', citation: 'Another text' }],
      }),
    ).toEqual([id]);
    const [again] = await t.db.select().from(bibliographicReferences).where(byId);
    expect(again?.fullCitation).toBe(citation);
    const audits = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, id ?? ''));
    expect(audits.map((a) => [a.action, a.metadata])).toEqual([
      ['references.created', { source: 'isbn' }],
    ]);
    // The confirmation's supporting reference goes through the same path.
    expect(
      await resolveSourceRef(ctx, user.id, { isbn: '9780306406157', citation }, 'reference'),
    ).toBe(id);
  });

  it('RFC-61 R10 cuts a long citation to 200 characters for the short citation only', async () => {
    const { user } = await createUser(t.db);
    const ctx = { db: t.db, doi: fakeDoiClient() };
    const citation = `${'Author, A.; '.repeat(25)}(2001). Seeds.`;
    const [id] = await resolveSources(ctx, user.id, {
      references: [{ isbn: randomIsbn(), citation }],
    });
    const [row] = await t.db
      .select()
      .from(bibliographicReferences)
      .where(eq(bibliographicReferences.id, id ?? ''));
    expect(row?.fullCitation).toBe(citation);
    expect(row?.shortCitation).toBe(`${citation.slice(0, 199)}…`);
    expect(row?.shortCitation).toHaveLength(200);
  });

  it('RFC-61 R10 refuses a malformed ISBN and counts one book given twice once', async () => {
    const { user } = await createUser(t.db);
    const ctx = { db: t.db, doi: fakeDoiClient() };
    await expect(
      resolveSources(ctx, user.id, { references: [{ isbn: '0-306-40615-3', citation: 'X' }] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sources.references.0.isbn' }],
    });
    const isbn = randomIsbn();
    await expect(
      resolveSources(ctx, user.id, {
        references: [
          { isbn, citation: 'A' },
          { isbn, citation: 'A' },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sources.references.1.isbn' }],
    });
  });
});
