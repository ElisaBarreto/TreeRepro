import type { Reference, ReferenceDetail, ReferenceKind } from '@treerepro/contracts';
import { and, asc, count, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import { traitVisible, UNRESTRICTED, type Visibility } from '../access/visibility.ts';
import { recordAudit } from '../audit/audit.ts';
import type { DbExecutor } from '../db/client.ts';
import { traitCategories, traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { referenceTraits } from '../db/schema/reference-traits.ts';
import { bibliographicReferences, type ReferenceRow } from '../db/schema/references.ts';
import { users } from '../db/schema/users.ts';
import {
  decodeCompositeCursor,
  encodeCompositeCursor,
  isDigits,
  isUuid,
  pageOf,
} from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import { type DoiMetadata, shortCitationFrom } from '../integrations/doi.ts';
import { requireTrait } from './dictionary.ts';
import { likePattern } from './taxa.ts';

/** @rfc RFC-61 R1, R4 */
export function toReference(
  row: ReferenceRow,
  observer?: { id: string; name: string } | null,
): Reference {
  return {
    id: row.id,
    citationKey: row.citationKey,
    title: row.title,
    authors: row.authors,
    year: row.year,
    journal: row.journal,
    doi: row.doi,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
    primaryCount: row.primaryCount,
    secondaryCount: row.secondaryCount,
    kind: row.kind,
    observer: observer?.id ? { id: observer.id, name: observer.name } : null,
    shortCitation: row.shortCitation,
    fullCitation: row.fullCitation,
  };
}

/**
 * An existing category, or 400 `VALIDATION_FAILED` on `categoryKey`. The
 * twin of `catalog.ts`'s private `requireCategory`: not shared, so each file
 * keeps its own tiny dependency on `trait_categories`.
 * @rfc RFC-61 R4
 */
async function requireCategory(db: DbExecutor, key: string): Promise<void> {
  const [row] = await db
    .select({ key: traitCategories.key })
    .from(traitCategories)
    .where(eq(traitCategories.key, key))
    .limit(1);
  if (!row) {
    throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
      { path: 'categoryKey', message: 'Unknown category' },
    ]);
  }
}

// A usage total in a cursor: digits that still fit a JS integer, so the bigint
// cast below never sees `Infinity`.
const isUsageCount = (part: string) => isDigits(part) && Number.isSafeInteger(Number(part));

/**
 * Most used first (`usage_count` = `primaryCount + secondaryCount` desc, then
 * id desc); composite cursor `[total, id]`. The counters are stored on the row
 * and maintained by the `trait_records` insert trigger (schema/references.ts),
 * so a page is one index-ordered scan of `bibliographic_references_usage_idx`
 * whatever the size of `trait_records`.
 *
 * `traitId` (a visible trait; unknown or invisible throws `TRAIT_NOT_FOUND`)
 * keeps references with a `reference_traits` row for it; `categoryKey` (an
 * existing category; unknown throws 400 `VALIDATION_FAILED`) keeps
 * references with a `reference_traits` row for any visible trait of that
 * category (RFC-61 R9).
 * @rfc RFC-61 R4, R9
 */
export async function searchReferences(
  db: DbExecutor,
  visibility: Visibility,
  input: {
    q?: string;
    cursor?: string;
    limit: number;
    kind?: ReferenceKind | 'all';
    traitId?: string;
    categoryKey?: string;
  },
): Promise<{ data: Reference[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  // No `kind` means publications only: a personal observation belongs to its
  // observer and is never offered as a source to pick from (RFC-61 R7).
  if (input.kind !== 'all') {
    conditions.push(eq(bibliographicReferences.kind, input.kind ?? 'publication'));
  }
  if (input.q) {
    const pattern = likePattern(input.q, 'substring');
    conditions.push(
      or(
        ilike(bibliographicReferences.citationKey, pattern),
        ilike(bibliographicReferences.title, pattern),
        ilike(bibliographicReferences.shortCitation, pattern),
      ) as SQL,
    );
  }
  if (input.traitId) {
    // Throws TRAIT_NOT_FOUND when the trait is unknown or, for this viewer,
    // invisible (RFC-33 R2, R4).
    await requireTrait(db, visibility, input.traitId);
    conditions.push(
      sql`exists (select 1 from ${referenceTraits} rt
        where rt.reference_id = ${bibliographicReferences.id} and rt.trait_id = ${input.traitId}::uuid)`,
    );
  }
  if (input.categoryKey) {
    await requireCategory(db, input.categoryKey);
    conditions.push(
      sql`exists (select 1 from ${referenceTraits} rt join ${traits} t on t.id = rt.trait_id
        where rt.reference_id = ${bibliographicReferences.id}
          and t.category_key = ${input.categoryKey} and ${traitVisible(visibility, sql`t.active`)})`,
    );
  }
  if (input.cursor) {
    const [total, id] = decodeCompositeCursor(input.cursor, 2, [isUsageCount, isUuid]) as [
      string,
      string,
    ];
    conditions.push(
      sql`(${bibliographicReferences.usageCount}, ${bibliographicReferences.id}) < (${Number(total)}::int, ${id}::uuid)`,
    );
  }
  const rows = await db
    .select({
      ref: bibliographicReferences,
      observer: { id: users.id, name: users.name },
    })
    .from(bibliographicReferences)
    .leftJoin(users, eq(users.id, bibliographicReferences.observerUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(bibliographicReferences.usageCount), desc(bibliographicReferences.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) =>
    encodeCompositeCursor([String(r.ref.usageCount), r.ref.id]),
  );
  return {
    data: page.map((r) => toReference(r.ref, r.observer?.id ? r.observer : null)),
    nextCursor,
  };
}

/**
 * `visibility` defaults to {@link UNRESTRICTED}: `catalog.ts`'s writers call
 * this with `(db, id)` alone to build the detail they return after a create
 * or update, and a curator privileged enough to write metadata sees every
 * trait the reference is used on. A route passes the viewer's own visibility
 * so `traits` (RFC-61 R9) lists visible traits only. `recordCount` takes no
 * visibility on purpose: it is a counter like `primaryCount` and
 * `secondaryCount` on the same row, and counters are the same for every
 * viewer (RFC-33 R3; the choice RFC-60 R7 makes for a species), so for a
 * restricted viewer the visible `traits` need not add up to it.
 * @rfc RFC-61 R4, R9
 * @rfc RFC-33 R2, R3
 */
export async function getReference(
  db: DbExecutor,
  id: string,
  visibility: Visibility = UNRESTRICTED,
): Promise<ReferenceDetail | null> {
  const [row] = await db
    .select({
      ref: bibliographicReferences,
      observer: { id: users.id, name: users.name },
    })
    .from(bibliographicReferences)
    .leftJoin(users, eq(users.id, bibliographicReferences.observerUserId))
    .where(eq(bibliographicReferences.id, id))
    .limit(1);
  if (!row) return null;
  const [counts, traitRows] = await Promise.all([
    db
      .select({ recordCount: count() })
      .from(traitRecords)
      .where(
        or(eq(traitRecords.primaryReferenceId, id), eq(traitRecords.secondaryReferenceId, id)),
      ),
    db
      .select({
        id: traits.id,
        key: traits.key,
        valueType: traits.valueType,
        unit: traits.unit,
        recordCount: referenceTraits.recordCount,
      })
      .from(referenceTraits)
      .innerJoin(traits, eq(traits.id, referenceTraits.traitId))
      .where(and(eq(referenceTraits.referenceId, id), traitVisible(visibility)))
      .orderBy(desc(referenceTraits.recordCount), asc(traits.key)),
  ]);
  return {
    ...toReference(row.ref, row.observer?.id ? row.observer : null),
    recordCount: counts[0]?.recordCount ?? 0,
    traits: traitRows.map((t) => ({
      trait: { id: t.id, key: t.key, valueType: t.valueType, unit: t.unit },
      recordCount: t.recordCount,
    })),
  };
}

/**
 * The kind of a reference, or null when it does not exist. Cheaper than
 * {@link getReference}, which also counts the records naming it.
 * @rfc RFC-61 R7
 */
export async function findReferenceKind(db: DbExecutor, id: string): Promise<ReferenceKind | null> {
  const [row] = await db
    .select({ kind: bibliographicReferences.kind })
    .from(bibliographicReferences)
    .where(eq(bibliographicReferences.id, id))
    .limit(1);
  return row?.kind ?? null;
}

/**
 * The user's own `personal_observation` reference, inserted on first use.
 * The insert cannot raise on a concurrent first use: `ON CONFLICT DO NOTHING`
 * against `bibliographic_references_observer_idx` leaves the transaction
 * usable (a raised 23505 would abort it and break the caller's re-read), and
 * the row is read back either way.
 * @rfc RFC-61 R7
 */
export async function ensurePersonalObservation(
  db: DbExecutor,
  userId: string,
): Promise<{ id: string }> {
  const readOwn = async () => {
    const [row] = await db
      .select({ id: bibliographicReferences.id })
      .from(bibliographicReferences)
      .where(
        and(
          eq(bibliographicReferences.kind, 'personal_observation'),
          eq(bibliographicReferences.observerUserId, userId),
        ),
      )
      .limit(1);
    return row;
  };

  const existing = await readOwn();
  if (existing) return existing;

  const [inserted] = await db
    .insert(bibliographicReferences)
    .values({
      citationKey: `personal-observation:${userId}`,
      kind: 'personal_observation',
      observerUserId: userId,
      createdBy: userId,
    })
    .onConflictDoNothing()
    .returning({ id: bibliographicReferences.id });

  if (!inserted) {
    const raced = await readOwn();
    if (!raced) throw new Error('ensurePersonalObservation: reference not found after insert');
    return raced;
  }

  await recordAudit(db, {
    actorUserId: userId,
    action: 'references.created',
    targetType: 'bibliographic_references',
    targetId: inserted.id,
    metadata: { kind: 'personal_observation' },
  });
  return inserted;
}

/** @rfc RFC-80 R1, R5 */
export async function findReferenceByDoi(db: DbExecutor, doi: string): Promise<Reference | null> {
  const normalised = doi.trim().toLowerCase();
  const [row] = await db
    .select({
      ref: bibliographicReferences,
      observer: { id: users.id, name: users.name },
    })
    .from(bibliographicReferences)
    .leftJoin(users, eq(users.id, bibliographicReferences.observerUserId))
    .where(sql`lower(${bibliographicReferences.doi}) = ${normalised}`)
    .limit(1);
  if (!row) return null;
  return toReference(row.ref, row.observer?.id ? row.observer : null);
}

/**
 * `full_citation` joins the parts Crossref actually returned with `. `,
 * always ending in the DOI url: `<authors> (<year>). <title>. <journal>.
 * https://doi.org/<doi>` when every part is present (the raw Crossref
 * `authors` string, not the derived {@link shortCitationFrom} string, plus
 * the row's own year, journal and normalised DOI) — but Crossref routinely
 * omits `journal` (datasets, books, preprints) or `authors`, so a missing
 * part is dropped rather than interpolated as `''`: no stray `. .` when
 * `journal` is absent, no leading `. ` when `authors` is absent, and no bare
 * `()` when `year` is absent.
 * @rfc RFC-61 R8
 */
export function fullCitationFrom(metadata: DoiMetadata, doi: string): string {
  const authorsYear =
    metadata.authors && metadata.year != null
      ? `${metadata.authors} (${metadata.year})`
      : (metadata.authors ?? (metadata.year != null ? `(${metadata.year})` : ''));
  const parts = [authorsYear, metadata.title, metadata.journal].filter((part): part is string =>
    Boolean(part),
  );
  return `${parts.join('. ')}. https://doi.org/${doi}`;
}

/**
 * The local reference for a DOI, created from the Crossref metadata on first
 * use. `ON CONFLICT DO NOTHING` rather than a caught 23505: a raised unique
 * violation aborts the surrounding transaction, so the re-read below would
 * then fail with 25P02 instead of returning the row the race created.
 * @rfc RFC-61 R8
 */
export async function createReferenceFromDoi(
  db: DbExecutor,
  input: { doi: string; metadata: DoiMetadata | null; actorId: string },
): Promise<Reference> {
  const norm = input.doi.trim().toLowerCase();
  const existing = await findReferenceByDoi(db, norm);
  if (existing) return existing;

  const shortCitation = input.metadata ? shortCitationFrom(input.metadata) : null;
  const fullCitation =
    input.metadata?.title != null ? fullCitationFrom(input.metadata, norm) : null;

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(bibliographicReferences)
      .values({
        citationKey: `doi:${norm}`,
        title: input.metadata?.title ?? null,
        authors: input.metadata?.authors ?? null,
        year: input.metadata?.year ?? null,
        journal: input.metadata?.journal ?? null,
        doi: norm,
        url: `https://doi.org/${norm}`,
        createdBy: input.actorId,
        kind: 'publication',
        shortCitation,
        fullCitation,
      })
      .onConflictDoNothing()
      .returning({ id: bibliographicReferences.id });
    if (inserted) {
      await recordAudit(tx, {
        actorUserId: input.actorId,
        action: 'references.created',
        targetType: 'bibliographic_references',
        targetId: inserted.id,
        metadata: { source: 'doi' },
      });
    }
    const found = await findReferenceByDoi(tx, norm);
    if (!found) throw new Error('createReferenceFromDoi: reference not found after insert');
    return found;
  });
}
