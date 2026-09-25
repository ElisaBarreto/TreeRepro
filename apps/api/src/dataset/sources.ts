import { isValidIsbn, type ResolveDoiResult } from '@treerepro/contracts';
import type { DbExecutor } from '../db/client.ts';
import { AppError } from '../http/errors.ts';
import type { DoiClient } from '../integrations/doi.ts';
import { normaliseDoi } from '../integrations/doi.ts';
import {
  createReferenceFromDoi,
  ensureBookReference,
  ensurePersonalObservation,
  findReferenceByDoi,
  findReferenceKind,
} from './references.ts';

const validation = (path: string, message: string) =>
  new AppError('VALIDATION_FAILED', 'Request validation failed', [{ path, message }]);

export type SourceRefInput = { id: string } | { doi: string } | { isbn: string; citation: string };

export type SourceInput = { personalObservation: true } | { references: SourceRefInput[] };

/**
 * One source to a reference id. `path` names the field in the request, so the
 * detail paths a client gets back are the ones it sent (`reference.doi` on an
 * annotation, `sources.references.2.doi` on a record). A book resolves
 * locally, never looked up (RFC-61 R10).
 * @rfc RFC-80 R5
 * @rfc RFC-61 R10
 */
export async function resolveSourceRef(
  ctx: { db: DbExecutor; doi: DoiClient },
  actorId: string,
  source: SourceRefInput,
  path: string,
): Promise<string> {
  if ('id' in source) {
    const kind = await findReferenceKind(ctx.db, source.id);
    if (kind === null) {
      throw new AppError('REFERENCE_NOT_FOUND', 'Reference not found', [
        { path: `${path}.id`, message: 'Reference not found' },
      ]);
    }
    // A personal observation belongs to its observer: it is only ever reached
    // through `{ personalObservation: true }`, never by naming someone else's
    // id (RFC-61 R7).
    if (kind === 'personal_observation') {
      throw new AppError(
        'REFERENCE_IS_PERSONAL',
        'A personal observation cannot be named as a reference',
        [{ path: `${path}.id`, message: 'A personal observation cannot be named as a reference' }],
      );
    }
    return source.id;
  }

  if ('isbn' in source) {
    const isbn = isValidIsbn(source.isbn);
    if (!isbn) throw validation(`${path}.isbn`, 'Invalid ISBN');
    const book = await ensureBookReference(ctx.db, {
      isbn,
      citation: source.citation.trim(),
      actorId,
    });
    return book.id;
  }

  const doi = normaliseDoi(source.doi);
  if (!doi) throw validation(`${path}.doi`, 'Malformed DOI');
  const known = await findReferenceByDoi(ctx.db, doi);
  if (known) return known.id;

  const status = await ctx.doi.exists(doi);
  if (status === 'failed') {
    throw new AppError('DOI_LOOKUP_FAILED', 'The DOI registry could not be reached');
  }
  if (status === 'not_found') throw validation(`${path}.doi`, 'DOI does not resolve');

  const metadata = await ctx.doi.metadata(doi);
  const created = await createReferenceFromDoi(ctx.db, { doi, metadata, actorId });
  return created.id;
}

/**
 * The sources of a claim to reference ids, in input order. Distinct after
 * resolution: an id and the DOI or ISBN of that same reference are one
 * source, and the second occurrence is a validation error naming it.
 * @rfc RFC-80 R5
 */
export async function resolveSources(
  ctx: { db: DbExecutor; doi: DoiClient },
  actorId: string,
  sources: SourceInput,
  path = 'sources',
): Promise<string[]> {
  if ('personalObservation' in sources) {
    return [(await ensurePersonalObservation(ctx.db, actorId)).id];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const [i, source] of sources.references.entries()) {
    const p = `${path}.references.${i}`;
    const id = await resolveSourceRef(ctx, actorId, source, p);
    if (seen.has(id)) {
      const field = 'id' in source ? 'id' : 'isbn' in source ? 'isbn' : 'doi';
      throw validation(`${p}.${field}`, 'Duplicate reference');
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** @rfc RFC-80 R4 */
export async function resolveDoi(
  ctx: { db: DbExecutor; doi: DoiClient },
  rawDoi: string,
): Promise<ResolveDoiResult> {
  const doi = normaliseDoi(rawDoi);
  if (!doi) {
    throw new AppError('VALIDATION_FAILED', 'Malformed DOI', [
      { path: 'doi', message: 'Malformed DOI' },
    ]);
  }
  const known = await findReferenceByDoi(ctx.db, doi);
  if (known) return { status: 'known', reference: known };

  const status = await ctx.doi.exists(doi);
  if (status === 'failed') {
    throw new AppError('DOI_LOOKUP_FAILED', 'The DOI registry could not be reached');
  }
  if (status === 'not_found') {
    return { status: 'not_found', reference: null };
  }
  const meta = await ctx.doi.metadata(doi);
  return {
    status: 'resolvable',
    reference: null,
    preview: {
      title: meta?.title ?? null,
      authors: meta?.authors ?? null,
      year: meta?.year ?? null,
      journal: meta?.journal ?? null,
    },
  };
}
