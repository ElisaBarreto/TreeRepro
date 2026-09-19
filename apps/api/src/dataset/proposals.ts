import type { ApproveProposalBody, Proposal, ProposalStatus } from '@treerepro/contracts';
import { and, count, desc, eq, gt, lt, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { speciesVisible, type Visibility } from '../access/visibility.ts';
import { recordAudit } from '../audit/audit.ts';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { speciesProposals } from '../db/schema/proposals.ts';
import { families, genera, species, speciesNames } from '../db/schema/taxa.ts';
import { users } from '../db/schema/users.ts';
import { decodeCursor, encodeCursor, pageOf } from '../http/cursor.ts';
import { AppError } from '../http/errors.ts';
import type { TaxonomyClient, TaxonomyLookup } from '../integrations/taxonomy.ts';
import { addSpeciesName, createFamily, createGenus, createSpecies } from './catalog.ts';
import { normaliseName } from './names.ts';

const proposer = alias(users, 'proposal_proposer');
const decider = alias(users, 'proposal_decider');

interface ProposalRow {
  id: string;
  proposedName: string;
  note: string | null;
  status: ProposalStatus;
  lookup: TaxonomyLookup | null;
  lookupAt: Date | null;
  createdAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
  proposerId: string;
  proposerName: string;
  decidedById: string | null;
  decidedByName: string | null;
  speciesId: string | null;
  speciesName: string | null;
}

/**
 * The one select every proposal read shares. The proposer and the decider
 * come through Drizzle's query builder and never raw SQL: `users.name` is an
 * RFC-40 encrypted column that only the column type decrypts, so a raw select
 * of it would hand back ciphertext (`trait-page.ts` carries the same note).
 * @rfc RFC-75 R6
 * @rfc RFC-40 R8
 */
function proposalQuery(db: DbExecutor) {
  return db
    .select({
      id: speciesProposals.id,
      proposedName: speciesProposals.proposedName,
      note: speciesProposals.note,
      status: speciesProposals.status,
      lookup: speciesProposals.lookup,
      lookupAt: speciesProposals.lookupAt,
      createdAt: speciesProposals.createdAt,
      decidedAt: speciesProposals.decidedAt,
      decisionNote: speciesProposals.decisionNote,
      proposerId: proposer.id,
      proposerName: proposer.name,
      decidedById: decider.id,
      decidedByName: decider.name,
      speciesId: species.id,
      speciesName: species.canonicalName,
    })
    .from(speciesProposals)
    .innerJoin(proposer, eq(proposer.id, speciesProposals.proposerId))
    .leftJoin(decider, eq(decider.id, speciesProposals.decidedBy))
    .leftJoin(species, eq(species.id, speciesProposals.speciesId));
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    proposedName: row.proposedName,
    note: row.note,
    status: row.status,
    proposer: { id: row.proposerId, name: row.proposerName },
    lookup: row.lookup,
    lookupAt: row.lookupAt?.toISOString() ?? null,
    species:
      row.speciesId && row.speciesName
        ? { id: row.speciesId, canonicalName: row.speciesName }
        : null,
    decidedBy:
      row.decidedById && row.decidedByName
        ? { id: row.decidedById, name: row.decidedByName }
        : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The id of a species the viewer can see carrying `name` as its canonical or
 * as an alternative name, case-insensitively.
 *
 * This is a pre-check of its own rather than a reuse of `createSpecies`'s
 * caught unique violation: the backing unique indexes are global and know
 * nothing of `active` or plot scope, and a caught `23505` cannot carry the
 * species id RFC-75 R2 requires in `details` so the web app can link to it.
 * `createSpecies` keeps its own, undetailed error for the approval path
 * (R4), where the collision may be with a species the proposer never saw.
 * @rfc RFC-75 R2
 * @rfc RFC-33 R2
 */
async function visibleSpeciesNamed(
  db: DbExecutor,
  visibility: Visibility,
  name: string,
): Promise<string | null> {
  const named: SQL = sql`(lower(${species.canonicalName}) = lower(${name}) or exists (
    select 1 from ${speciesNames} sn
    where sn.species_id = ${species.id} and lower(sn.name) = lower(${name})))`;
  const [row] = await db
    .select({ id: species.id })
    .from(species)
    .where(and(named, speciesVisible(visibility)))
    .limit(1);
  return row?.id ?? null;
}

/** The id of the open proposal already holding this name, if any. @rfc RFC-75 R2 */
async function openProposalNamed(db: DbExecutor, name: string): Promise<string | null> {
  const [row] = await db
    .select({ id: speciesProposals.id })
    .from(speciesProposals)
    .where(
      and(
        eq(speciesProposals.status, 'open'),
        sql`lower(${speciesProposals.proposedName}) = lower(${name})`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function proposalOrThrow(db: DbExecutor, id: string, where: string): Promise<Proposal> {
  const found = await getProposal(db, id);
  if (!found) throw new Error(`${where}: proposal vanished`);
  return found;
}

/**
 * A contributor's proposal for a species the catalog does not hold.
 *
 * The lookup runs before the insert so the row is written once, and a lookup
 * that failed outright is stored as `null` rather than failing the request:
 * the proposal is about the name, not about GBIF being reachable (RFC-81 R4
 * gives the direct `GET /api/taxonomy/match` route the opposite rule).
 * @rfc RFC-75 R2
 * @rfc RFC-81 R3
 */
export async function createProposal(
  ctx: { db: DbExecutor; taxonomy: TaxonomyClient },
  visibility: Visibility,
  input: { name: string; note?: string; proposerId: string },
): Promise<Proposal> {
  const name = normaliseName(input.name);

  const takenBy = await visibleSpeciesNamed(ctx.db, visibility, name);
  if (takenBy) {
    throw new AppError('SPECIES_NAME_TAKEN', 'A species with this name is already in the catalog', [
      { path: 'name', message: takenBy },
    ]);
  }
  const alreadyOpen = await openProposalNamed(ctx.db, name);
  if (alreadyOpen) {
    throw new AppError('PROPOSAL_EXISTS', 'This species has already been proposed', [
      { path: 'name', message: alreadyOpen },
    ]);
  }

  const result = await ctx.taxonomy.match(name);
  const lookup = result.verdict === 'failed' ? null : result;

  let id: string;
  try {
    id = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(speciesProposals)
        .values({
          proposedName: name,
          note: input.note ?? null,
          proposerId: input.proposerId,
          lookup,
          lookupAt: lookup ? new Date() : null,
        })
        .returning({ id: speciesProposals.id });
      if (!row) throw new Error('createProposal: insert returned no row');
      // RFC-41 R7 and RFC-75 R2: the proposed name is not metadata.
      await recordAudit(tx, {
        actorUserId: input.proposerId,
        action: 'proposals.created',
        targetType: 'species_proposals',
        targetId: row.id,
        metadata: {},
      });
      return row.id;
    });
  } catch (err) {
    // The pre-check above is not a lock: a proposal committed between it and
    // this insert still hits the partial unique index.
    if (isUniqueViolation(err)) {
      const raced = await openProposalNamed(ctx.db, name);
      throw new AppError(
        'PROPOSAL_EXISTS',
        'This species has already been proposed',
        raced ? [{ path: 'name', message: raced }] : undefined,
      );
    }
    throw err;
  }
  return proposalOrThrow(ctx.db, id, 'createProposal');
}

/**
 * Proposals newest first, keyed on the uuidv7 primary key. `status` filters
 * when given; the route applies RFC-75 R3's `open` default.
 * @rfc RFC-75 R3
 * @rfc RFC-11 R6
 */
export async function listProposals(
  db: DbExecutor,
  input: { status?: ProposalStatus; cursor?: string; limit: number },
): Promise<{ data: Proposal[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  if (input.status) conditions.push(eq(speciesProposals.status, input.status));
  if (input.cursor) conditions.push(lt(speciesProposals.id, decodeCursor(input.cursor)));
  const rows = await proposalQuery(db)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(speciesProposals.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.id));
  return { data: page.map(toProposal), nextCursor };
}

/** @rfc RFC-75 R3 */
export async function getProposal(db: DbExecutor, id: string): Promise<Proposal | null> {
  const [row] = await proposalQuery(db).where(eq(speciesProposals.id, id)).limit(1);
  return row ? toProposal(row) : null;
}

/**
 * One proposer's own proposals, any status, newest first.
 * @rfc RFC-75 R5
 * @rfc RFC-11 R6
 */
export async function listMyProposals(
  db: DbExecutor,
  userId: string,
  input: { cursor?: string; limit: number },
): Promise<{ data: Proposal[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(speciesProposals.proposerId, userId)];
  if (input.cursor) conditions.push(lt(speciesProposals.id, decodeCursor(input.cursor)));
  const rows = await proposalQuery(db)
    .where(and(...conditions))
    .orderBy(desc(speciesProposals.id))
    .limit(input.limit + 1);
  const { page, nextCursor } = pageOf(rows, input.limit, (r) => encodeCursor(r.id));
  return { data: page.map(toProposal), nextCursor };
}

/** The open proposal, locked for the decision about to be written. @rfc RFC-75 R4 */
async function lockOpenProposal(tx: DbExecutor, id: string): Promise<void> {
  const [row] = await tx
    .select({ status: speciesProposals.status })
    .from(speciesProposals)
    .where(eq(speciesProposals.id, id))
    .limit(1)
    .for('update');
  if (!row) throw new AppError('PROPOSAL_NOT_FOUND', 'Proposal not found');
  if (row.status !== 'open')
    throw new AppError('PROPOSAL_DECIDED', 'This proposal has already been decided');
}

/** The family of that name, created when it is missing. @rfc RFC-60 R9 */
async function familyIdFor(tx: DbExecutor, name: string, actorId: string): Promise<string> {
  const wanted = normaliseName(name);
  const [row] = await tx
    .select({ id: families.id })
    .from(families)
    .where(eq(families.name, wanted))
    .limit(1);
  if (row) return row.id;
  return (await createFamily(tx, { name: wanted, actorId })).id;
}

/**
 * The genus the approved species is filed under, created when it is missing
 * — and the family only then. The genus is resolved **first**: a species
 * carries `genus_id` alone (RFC-60 R9), so an existing genus already places
 * the species, under its own family, and the body's `familyName` has nothing
 * left to attach itself to. Resolving the family first instead created one
 * that the reused genus then discarded — a family row nothing points at,
 * committed inside the approval, while the species went under a hierarchy
 * the approval body never described. `familyName` is a prefill from the GBIF
 * match, not an instruction to re-parent a genus other species already sit
 * in: when it disagrees with the existing genus's family, the genus's own
 * family stands and the name is ignored.
 * @rfc RFC-75 R4
 * @rfc RFC-60 R9
 */
async function genusIdFor(
  tx: DbExecutor,
  body: ApproveProposalBody,
  actorId: string,
): Promise<string | undefined> {
  if (!body.genusName) return undefined;
  const wanted = normaliseName(body.genusName);
  const [row] = await tx
    .select({ id: genera.id })
    .from(genera)
    .where(eq(genera.name, wanted))
    .limit(1);
  if (row) return row.id;
  const familyId = body.familyName ? await familyIdFor(tx, body.familyName, actorId) : undefined;
  return (await createGenus(tx, { name: wanted, familyId, actorId })).id;
}

/**
 * Approving a proposal in one transaction: the genus (and, only when the
 * genus has to be created, its family), the species and each alternative
 * name are created exactly as `POST /api/species` creates them, each with
 * its own `taxa.created` row, and the decision and its `proposals.decided`
 * row are written last. A canonical name already taken by *any* species —
 * including one the proposer could not see — surfaces as `createSpecies`'s
 * own 409 `SPECIES_NAME_TAKEN` and rolls the whole approval back, leaving
 * the proposal open.
 * @rfc RFC-75 R4
 * @rfc RFC-60 R9, R10
 */
export async function approveProposal(
  db: DbExecutor,
  input: { id: string; body: ApproveProposalBody; actorId: string },
): Promise<Proposal> {
  return db.transaction(async (tx) => {
    await lockOpenProposal(tx, input.id);
    const genusId = await genusIdFor(tx, input.body, input.actorId);
    const created = await createSpecies(tx, {
      canonicalName: input.body.canonicalName,
      nameSource: input.body.nameSource,
      genusId,
      actorId: input.actorId,
    });
    for (const alternative of input.body.alternativeNames ?? []) {
      await addSpeciesName(tx, {
        speciesId: created.id,
        name: alternative.name,
        nameType: alternative.nameType,
        language: alternative.language,
        source: alternative.source,
        gbifUsageKey: alternative.gbifUsageKey,
        actorId: input.actorId,
      });
    }
    await tx
      .update(speciesProposals)
      .set({
        status: 'approved',
        speciesId: created.id,
        decidedBy: input.actorId,
        decidedAt: new Date(),
      })
      .where(eq(speciesProposals.id, input.id));
    await recordAudit(tx, {
      actorUserId: input.actorId,
      action: 'proposals.decided',
      targetType: 'species_proposals',
      targetId: input.id,
      metadata: { decision: 'approved', speciesId: created.id },
    });
    return proposalOrThrow(tx, input.id, 'approveProposal');
  });
}

/** @rfc RFC-75 R4 */
export async function rejectProposal(
  db: DbExecutor,
  input: { id: string; note: string; actorId: string },
): Promise<Proposal> {
  return db.transaction(async (tx) => {
    await lockOpenProposal(tx, input.id);
    await tx
      .update(speciesProposals)
      .set({
        status: 'rejected',
        decisionNote: input.note,
        decidedBy: input.actorId,
        decidedAt: new Date(),
      })
      .where(eq(speciesProposals.id, input.id));
    await recordAudit(tx, {
      actorUserId: input.actorId,
      action: 'proposals.decided',
      targetType: 'species_proposals',
      targetId: input.id,
      metadata: { decision: 'rejected', speciesId: null },
    });
    return proposalOrThrow(tx, input.id, 'rejectProposal');
  });
}

/**
 * The direct lookup behind the species dialog's **Look up** button. Unlike a
 * proposal, which stores `null` and carries on, this route tells the caller
 * the platform could not reach GBIF.
 * @rfc RFC-81 R4
 */
export async function matchTaxon(
  ctx: { taxonomy: TaxonomyClient },
  name: string,
): Promise<TaxonomyLookup> {
  const lookup = await ctx.taxonomy.match(normaliseName(name));
  if (lookup.verdict === 'failed')
    throw new AppError('TAXONOMY_LOOKUP_FAILED', 'The taxonomy lookup could not be completed');
  return lookup;
}

/** The dashboard's `queues.proposals` (RFC-72 R1). @rfc RFC-75 R7 */
export async function countOpenProposals(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(speciesProposals)
    .where(eq(speciesProposals.status, 'open'));
  return row?.count ?? 0;
}

/**
 * The digest's `proposals` (RFC-74 R3): proposals created inside the window,
 * whatever became of them since.
 * @rfc RFC-75 R7
 */
export async function countProposalsCreated(
  db: DbExecutor,
  window: { start: Date; end: Date },
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(speciesProposals)
    .where(
      and(
        gt(speciesProposals.createdAt, window.start),
        lte(speciesProposals.createdAt, window.end),
      ),
    );
  return row?.count ?? 0;
}
