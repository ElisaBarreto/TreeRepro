import { and, eq, sql } from 'drizzle-orm';
import {
  levelVisible,
  speciesVisible,
  traitVisible,
  type Visibility,
} from '../access/visibility.ts';
import type { DbExecutor } from '../db/client.ts';
import { contestEvents, contestLevels, contestRecords, contests } from '../db/schema/contests.ts';
import { recordAnnotations } from '../db/schema/curation.ts';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { traitRecords } from '../db/schema/records.ts';
import { species } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
import { contestWithdrawnSql } from './contests.ts';
import { lockSpeciesTrait } from './curation.ts';
import { recordVisible } from './records.ts';

const notFound = () => new AppError('RECORD_NOT_FOUND', 'Contest not found');

/**
 * The contest the actor may act on, read under its species × trait lock
 * (E3): a bare by-id lookup takes the lock, then the contest must be not
 * withdrawn and its species, trait and every level it names visible (404
 * otherwise).
 * ponytail: the visibility predicate mirrors `contestVisibleSql` in
 * `contributions.ts`, which plan 13g Task 8 promotes to `contests.ts`;
 * reuse that one once both have merged.
 */
async function requireContest(
  tx: DbExecutor,
  visibility: Visibility,
  contestId: string,
): Promise<{ id: string; createdBy: string }> {
  const [ids] = await tx
    .select({ speciesId: contests.speciesId, traitId: contests.traitId })
    .from(contests)
    .where(eq(contests.id, contestId))
    .limit(1);
  if (!ids) throw notFound();
  await lockSpeciesTrait(tx, ids.speciesId, ids.traitId);
  const [row] = await tx
    .select({ id: contests.id, createdBy: contests.createdBy })
    .from(contests)
    .innerJoin(species, eq(species.id, contests.speciesId))
    .innerJoin(traits, eq(traits.id, contests.traitId))
    .where(
      and(
        eq(contests.id, contestId),
        speciesVisible(visibility),
        traitVisible(visibility),
        sql`not ${contestWithdrawnSql('contests')}`,
        sql`not exists (select 1 from ${contestLevels}
          join ${traitLevels} on ${traitLevels.id} = ${contestLevels.levelId}
          where ${contestLevels.contestId} = ${contests.id}
            and not ${levelVisible(visibility)})`,
      ),
    )
    .limit(1);
  if (!row) throw notFound();
  return row;
}

/**
 * Keep both: marks the contest resolved; on a resolved contest it changes
 * nothing and answers the same.
 * @rfc RFC-65 R15, R16
 * @rfc RFC-33 R5
 */
export async function resolveContest(
  db: DbExecutor,
  visibility: Visibility,
  input: { contestId: string; actorId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const contest = await requireContest(tx, visibility, input.contestId);
    await tx
      .insert(contestEvents)
      .values({ contestId: contest.id, actorId: input.actorId, kind: 'resolve' })
      .onConflictDoNothing();
  });
}

/**
 * Withdraw contest, by its author or a `records.withdraw` holder (a contest
 * is manual, RFC-65 R4): a `withdraw` on every visible record it created, or
 * — when it created none — a `withdraw` event. A resolved contest may still
 * be withdrawn.
 * @rfc RFC-65 R4, R16
 * @rfc RFC-33 R5
 */
export async function withdrawContest(
  db: DbExecutor,
  visibility: Visibility,
  input: { contestId: string; actorId: string; canWithdrawAny: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const contest = await requireContest(tx, visibility, input.contestId);
    if (contest.createdBy !== input.actorId && !input.canWithdrawAny) {
      throw new AppError('PERMISSION_DENIED', 'You may not withdraw this contest');
    }
    const created = await tx
      .select({ recordId: contestRecords.recordId })
      .from(contestRecords)
      .where(eq(contestRecords.contestId, contest.id));
    if (created.length === 0) {
      await tx
        .insert(contestEvents)
        .values({ contestId: contest.id, actorId: input.actorId, kind: 'withdraw' });
      return;
    }
    const visible = await tx
      .select({ recordId: traitRecords.id })
      .from(traitRecords)
      .innerJoin(contestRecords, eq(contestRecords.recordId, traitRecords.id))
      .where(and(eq(contestRecords.contestId, contest.id), recordVisible(visibility)));
    if (visible.length === 0) return;
    await tx
      .insert(recordAnnotations)
      .values(
        visible.map((r) => ({
          recordId: r.recordId,
          actorId: input.actorId,
          kind: 'withdraw' as const,
        })),
      )
      .onConflictDoNothing();
  });
}
