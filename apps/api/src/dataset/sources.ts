import type { ResolveDoiResult } from '@treerepro/contracts';
import type { DbExecutor } from '../db/client.ts';
import { AppError } from '../http/errors.ts';
import type { DoiClient } from '../integrations/doi.ts';
import { normaliseDoi } from '../integrations/doi.ts';
import {
  createReferenceFromDoi,
  ensurePersonalObservation,
  findReferenceByDoi,
  findReferenceKind,
} from './references.ts';

const validation = (path: string, message: string) =>
  new AppError('VALIDATION_FAILED', 'Request validation failed', [{ path, message }]);

export type SourceInput =
  | { personalObservation: true }
  | { references: ({ id: string } | { doi: string })[] };

/** @rfc RFC-80 R5 */
export async function resolveSources(
  ctx: { db: DbExecutor; doi: DoiClient },
  actorId: string,
  sources: SourceInput,
  path = 'sources',
): Promise<string[]> {
  if ('personalObservation' in sources) {
    return [(await ensurePersonalObservation(ctx.db, actorId)).id];
  }
  // Distinct after resolution: two sources that end on the same reference —
  // an id and the DOI of that same reference — would otherwise ask for the
  // same claim twice.
  const seen = new Set<string>();
  const ids: string[] = [];
  const take = (id: string, path: string, message: string) => {
    if (seen.has(id)) throw validation(path, message);
    seen.add(id);
    ids.push(id);
  };
  for (const [i, s] of sources.references.entries()) {
    const p = `${path}.references.${i}`;
    if ('id' in s) {
      const kind = await findReferenceKind(ctx.db, s.id);
      if (kind === null) {
        throw new AppError('REFERENCE_NOT_FOUND', 'Reference not found', [
          { path: `${p}.id`, message: 'Reference not found' },
        ]);
      }
      // A personal observation belongs to its observer: it is only ever
      // reached through `{ personalObservation: true }`, never by naming
      // someone else's id (RFC-61 R7).
      if (kind === 'personal_observation') {
        throw new AppError(
          'REFERENCE_IS_PERSONAL',
          'A personal observation cannot be named as a reference',
          [{ path: `${p}.id`, message: 'A personal observation cannot be named as a reference' }],
        );
      }
      take(s.id, `${p}.id`, 'Duplicate reference');
      continue;
    }
    const doi = normaliseDoi(s.doi);
    if (!doi) throw validation(`${p}.doi`, 'Malformed DOI');
    const known = await findReferenceByDoi(ctx.db, doi);
    if (known) {
      take(known.id, `${p}.doi`, 'Duplicate DOI');
      continue;
    }
    const status = await ctx.doi.exists(doi);
    if (status === 'failed') {
      throw new AppError('DOI_LOOKUP_FAILED', 'The DOI registry could not be reached');
    }
    if (status === 'not_found') {
      throw validation(`${p}.doi`, 'DOI does not resolve');
    }
    const meta = await ctx.doi.metadata(doi);
    const created = await createReferenceFromDoi(ctx.db, {
      doi,
      metadata: meta,
      actorId,
    });
    take(created.id, `${p}.doi`, 'Duplicate DOI');
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
