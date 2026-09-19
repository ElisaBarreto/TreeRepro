import { randomBytes } from 'node:crypto';
import type { Lookup } from '@treerepro/contracts';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestApp } from '../../test/helpers/app.ts';
import { createSpecies } from '../../test/helpers/dataset.ts';
import { withRollback } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { UNRESTRICTED, type Visibility } from '../access/visibility.ts';
import type { DbExecutor, DbTransaction } from '../db/client.ts';
import { auditLog } from '../db/schema/audit-log.ts';
import { speciesProposals } from '../db/schema/proposals.ts';
import { families, genera, species, speciesNames } from '../db/schema/taxa.ts';
import { AppError } from '../http/errors.ts';
import {
  approveProposal,
  countOpenProposals,
  countProposalsCreated,
  createProposal,
  getProposal,
  listMyProposals,
  listProposals,
  matchTaxon,
  rejectProposal,
} from './proposals.ts';

const tag = () => randomBytes(6).toString('hex');

/**
 * R-E: the partial unique index on an open proposal's name is a global
 * resource and the integration suites share one database, so every proposed
 * name in this file is random.
 */
const aName = () => `Testus propositus ${tag()}`;

/** A viewer who cannot see inactive species (RFC-33 R1). */
const ACTIVE_ONLY: Visibility = { inactive: false, plotIds: null };

const failedLookup: Lookup = { backbone: null, wcvp: null, verdict: 'failed' };

const exactLookup = (name: string): Lookup => ({
  backbone: {
    matchType: 'EXACT',
    confidence: 99,
    usageKey: '2878688',
    scientificName: `${name} L.`,
    canonicalName: name,
    rank: 'SPECIES',
    status: 'ACCEPTED',
    family: 'Fagaceae',
    genus: 'Quercus',
    acceptedUsageKey: null,
    note: null,
  },
  wcvp: null,
  verdict: 'exact',
});

/**
 * A repeatable-read snapshot, as `workspace/dashboard.integration.test.ts`
 * takes: the only way a count delta is comparable while a sibling suite may
 * commit a proposal of its own between the two reads.
 */
async function freezeSnapshot(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`set transaction isolation level repeatable read`);
  const [isolation] = (await tx.execute(sql`show transaction_isolation`)) as unknown as [
    { transaction_isolation: string } | undefined,
  ];
  expect(isolation?.transaction_isolation).toBe('repeatable read');
}

const auditRows = (db: DbExecutor, targetId: string) =>
  db
    .select({
      action: auditLog.action,
      actorUserId: auditLog.actorUserId,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .where(eq(auditLog.targetId, targetId));

describe('RFC-75 R2 createProposal', () => {
  const t = useTestApp();

  it('stores the lookup the client answered and audits proposals.created without the name', async () => {
    const { user } = await createUser(t.db);
    const name = aName();
    t.taxonomy.answers.set(name, exactLookup(name));

    const proposal = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name,
      note: 'Found in plot 3',
      proposerId: user.id,
    });

    expect(proposal).toMatchObject({
      proposedName: name,
      note: 'Found in plot 3',
      status: 'open',
      proposer: { id: user.id, name: 'Test User' },
      species: null,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    });
    expect(proposal.lookup).toEqual(exactLookup(name));
    expect(proposal.lookupAt).not.toBeNull();

    const audits = await auditRows(t.db, proposal.id);
    expect(audits).toEqual([
      {
        action: 'proposals.created',
        actorUserId: user.id,
        targetType: 'species_proposals',
        targetId: proposal.id,
        metadata: {},
      },
    ]);
    // R2 spells it out: the proposed name never enters the audit metadata.
    expect(JSON.stringify(audits)).not.toContain(name);
  });

  it('answers SPECIES_NAME_TAKEN carrying the species id when a visible species has the canonical name', async () => {
    const { user } = await createUser(t.db);
    const existing = await createSpecies(t.db);

    const error = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      // Case-insensitively the same name: R2 compares names, not spellings.
      name: existing.canonicalName.toUpperCase(),
      proposerId: user.id,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'SPECIES_NAME_TAKEN',
      details: [{ path: 'name', message: existing.id }],
    });
  });

  it('answers SPECIES_NAME_TAKEN when a visible species carries the name as an alternative name', async () => {
    const { user } = await createUser(t.db);
    const synonym = `Testus synonymus ${tag()}`;
    const existing = await createSpecies(t.db, { names: [{ name: synonym, nameType: 'synonym' }] });

    const error = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: synonym,
      proposerId: user.id,
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: 'SPECIES_NAME_TAKEN',
      details: [{ path: 'name', message: existing.id }],
    });
  });

  it('creates the proposal when the species carrying the name is one the viewer cannot see (RFC-33 R2)', async () => {
    const { user } = await createUser(t.db);
    const hidden = await createSpecies(t.db);
    await t.db.update(species).set({ active: false }).where(eq(species.id, hidden.id));

    const proposal = await createProposal({ db: t.db, taxonomy: t.taxonomy }, ACTIVE_ONLY, {
      name: hidden.canonicalName,
      proposerId: user.id,
    });

    expect(proposal.status).toBe('open');
    expect(proposal.proposedName).toBe(hidden.canonicalName);
  });

  it('answers PROPOSAL_EXISTS with the open proposal id for the same name in another case', async () => {
    const { user } = await createUser(t.db);
    const other = await createUser(t.db);
    const name = aName();
    const first = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name,
      proposerId: user.id,
    });

    const error = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: name.toUpperCase(),
      proposerId: other.user.id,
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: 'PROPOSAL_EXISTS',
      details: [{ path: 'name', message: first.id }],
    });
  });

  it('answers PROPOSAL_EXISTS when the name is taken while the lookup is running', async () => {
    const { user } = await createUser(t.db);
    const interloper = await createUser(t.db);
    const name = aName();
    // The pre-check is not a lock, and the seam is deterministic rather than
    // concurrent: `createProposal` runs the pre-check, then the lookup, then
    // the insert. A client that writes the colliding row while it is "talking
    // to GBIF" drives the caught 23505 exactly once, with no racing needed.
    const racing = {
      match: async () => {
        await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
          name,
          proposerId: interloper.user.id,
        });
        return failedLookup;
      },
    };

    const error = await createProposal({ db: t.db, taxonomy: racing }, UNRESTRICTED, {
      name,
      proposerId: user.id,
    }).catch((e: unknown) => e);

    const winner = await listMyProposals(t.db, interloper.user.id, { limit: 10 });
    expect(error).toMatchObject({
      code: 'PROPOSAL_EXISTS',
      details: [{ path: 'name', message: winner.data[0]?.id }],
    });
  });

  it('still creates the proposal with a null lookup when every attempted GBIF call failed', async () => {
    const { user } = await createUser(t.db);
    const name = aName();

    const proposal = await createProposal(
      { db: t.db, taxonomy: { match: async () => failedLookup } },
      UNRESTRICTED,
      { name, proposerId: user.id },
    );

    expect(proposal.status).toBe('open');
    expect(proposal.lookup).toBeNull();
    expect(proposal.lookupAt).toBeNull();
  });
});

describe('RFC-75 R3 listProposals and getProposal', () => {
  const t = useTestApp();

  it('lists one status newest first and leaves the other statuses out', async () => {
    const { user } = await createUser(t.db);
    const manager = await createUser(t.db);
    const older = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: user.id,
    });
    const newer = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: user.id,
    });
    const decided = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: user.id,
    });
    await rejectProposal(t.db, { id: decided.id, note: 'Not a tree', actorId: manager.user.id });

    // R-E: a sibling suite may hold open proposals of its own, so this is
    // containment and relative order, never an absolute page.
    const { data } = await listProposals(t.db, { status: 'open', limit: 200 });
    const ids = data.map((p) => p.id);
    expect(ids).toContain(newer.id);
    expect(ids).toContain(older.id);
    expect(ids).not.toContain(decided.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));

    const rejected = await listProposals(t.db, { status: 'rejected', limit: 200 });
    expect(rejected.data.map((p) => p.id)).toContain(decided.id);
  });

  it('pages with a keyset cursor', async () => {
    const { user } = await createUser(t.db);
    const first = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: user.id,
    });
    const second = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: user.id,
    });

    const page = await listMyProposals(t.db, user.id, { limit: 1 });
    expect(page.data.map((p) => p.id)).toEqual([second.id]);
    expect(page.nextCursor).not.toBeNull();
    const next = await listMyProposals(t.db, user.id, {
      limit: 1,
      cursor: page.nextCursor ?? undefined,
    });
    expect(next.data.map((p) => p.id)).toEqual([first.id]);
  });

  it('getProposal answers null for an id that does not exist', async () => {
    expect(await getProposal(t.db, '00000000-0000-7000-8000-000000000000')).toBeNull();
  });
});

describe('RFC-75 R4 approveProposal', () => {
  const t = useTestApp();

  it('creates the species with the genus and family of the body, links it and audits both writes', async () => {
    const { user } = await createUser(t.db);
    const manager = await createUser(t.db);
    const name = aName();
    const proposal = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name,
      proposerId: user.id,
    });
    const familyName = `Testaceae-${tag()}`;
    const genusName = `Testus-${tag()}`;
    const synonym = `Testus obsoletus ${tag()}`;

    const approved = await approveProposal(t.db, {
      id: proposal.id,
      actorId: manager.user.id,
      body: {
        canonicalName: name,
        nameSource: 'gbif',
        genusName,
        familyName,
        alternativeNames: [{ name: synonym, nameType: 'synonym' }],
      },
    });

    expect(approved).toMatchObject({
      id: proposal.id,
      status: 'approved',
      decidedBy: { id: manager.user.id, name: 'Test User' },
      decisionNote: null,
    });
    expect(approved.decidedAt).not.toBeNull();
    expect(approved.species?.canonicalName).toBe(name);

    const speciesId = approved.species?.id ?? '';
    const [createdSpecies] = await t.db
      .select({ id: species.id, genusId: species.genusId, nameSource: species.nameSource })
      .from(species)
      .where(eq(species.id, speciesId));
    expect(createdSpecies?.nameSource).toBe('gbif');

    // The chain the body asked for, followed link by link: the species' genus
    // is the genus of that name, and that genus' family is the family of that
    // name. Asserting only that `genusId` is not null would pass against any
    // pre-existing genus.
    const [createdGenus] = await t.db
      .select({ id: genera.id, name: genera.name, familyId: genera.familyId })
      .from(genera)
      .where(eq(genera.id, createdSpecies?.genusId ?? ''));
    expect(createdGenus?.name).toBe(genusName);
    const [createdFamily] = await t.db
      .select({ id: families.id, name: families.name })
      .from(families)
      .where(eq(families.id, createdGenus?.familyId ?? ''));
    expect(createdFamily?.name).toBe(familyName);

    // The alternative name is a row of its own, not a field of the species.
    const alternatives = await t.db
      .select({ id: speciesNames.id, name: speciesNames.name, nameType: speciesNames.nameType })
      .from(speciesNames)
      .where(eq(speciesNames.speciesId, speciesId));
    expect(alternatives).toEqual([{ id: expect.any(String), name: synonym, nameType: 'synonym' }]);

    // RFC-60 R10: the family, the genus, the species and the alternative name
    // each carry their own `taxa.created` row, on its own target.
    for (const targetId of [
      createdFamily?.id ?? '',
      createdGenus?.id ?? '',
      speciesId,
      alternatives[0]?.id ?? '',
    ]) {
      const rows = await auditRows(t.db, targetId);
      expect(
        rows.map((a) => a.action),
        targetId,
      ).toEqual(['taxa.created']);
      expect(rows[0]?.actorUserId, targetId).toBe(manager.user.id);
    }

    const decision = await auditRows(t.db, proposal.id);
    expect(decision.map((a) => a.action).sort()).toEqual([
      'proposals.created',
      'proposals.decided',
    ]);
    expect(decision.find((a) => a.action === 'proposals.decided')).toMatchObject({
      actorUserId: manager.user.id,
      targetType: 'species_proposals',
      metadata: { decision: 'approved', speciesId },
    });
  });

  it('refuses a second decision with PROPOSAL_DECIDED', async () => {
    const { user } = await createUser(t.db);
    const manager = await createUser(t.db);
    const proposal = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: user.id,
    });
    await rejectProposal(t.db, {
      id: proposal.id,
      note: 'Already known',
      actorId: manager.user.id,
    });

    await expect(
      approveProposal(t.db, {
        id: proposal.id,
        actorId: manager.user.id,
        body: { canonicalName: aName(), nameSource: 'original' },
      }),
    ).rejects.toMatchObject({ code: 'PROPOSAL_DECIDED' });
    await expect(
      rejectProposal(t.db, { id: proposal.id, note: 'Again', actorId: manager.user.id }),
    ).rejects.toMatchObject({ code: 'PROPOSAL_DECIDED' });
  });

  it('answers PROPOSAL_NOT_FOUND for an id that does not exist', async () => {
    const manager = await createUser(t.db);
    await expect(
      rejectProposal(t.db, {
        id: '00000000-0000-7000-8000-000000000000',
        note: 'No',
        actorId: manager.user.id,
      }),
    ).rejects.toMatchObject({ code: 'PROPOSAL_NOT_FOUND' });
  });

  it("answers SPECIES_NAME_TAKEN without details when the global index fires for a species the proposer could not see (R-L's second layer)", async () => {
    const { user } = await createUser(t.db);
    const manager = await createUser(t.db);
    const hidden = await createSpecies(t.db);
    await t.db.update(species).set({ active: false }).where(eq(species.id, hidden.id));
    // The pre-check is visibility-scoped, so the proposal is created.
    const proposal = await createProposal({ db: t.db, taxonomy: t.taxonomy }, ACTIVE_ONLY, {
      name: hidden.canonicalName,
      proposerId: user.id,
    });

    // The family and the genus are written before `createSpecies` raises, so
    // they are what proves the whole approval is one transaction.
    const familyName = `Testaceae-${tag()}`;
    const genusName = `Testus-${tag()}`;

    const error = await approveProposal(t.db, {
      id: proposal.id,
      actorId: manager.user.id,
      body: {
        canonicalName: hidden.canonicalName,
        nameSource: 'original',
        genusName,
        familyName,
      },
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'SPECIES_NAME_TAKEN' });
    expect((error as AppError).details).toBeUndefined();
    // The failed approval left the proposal open and wrote nothing at all:
    // no orphan family, no orphan genus.
    expect((await getProposal(t.db, proposal.id))?.status).toBe('open');
    const orphanFamilies = await t.db
      .select({ id: families.id })
      .from(families)
      .where(eq(families.name, familyName));
    const orphanGenera = await t.db
      .select({ id: genera.id })
      .from(genera)
      .where(eq(genera.name, genusName));
    expect(orphanFamilies).toEqual([]);
    expect(orphanGenera).toEqual([]);
  });

  it('stores the decision note on a rejection and leaves the species null', async () => {
    const { user } = await createUser(t.db);
    const manager = await createUser(t.db);
    const proposal = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: user.id,
    });

    const rejected = await rejectProposal(t.db, {
      id: proposal.id,
      note: 'Already in the catalog as a synonym',
      actorId: manager.user.id,
    });

    expect(rejected).toMatchObject({
      status: 'rejected',
      decisionNote: 'Already in the catalog as a synonym',
      species: null,
      decidedBy: { id: manager.user.id, name: 'Test User' },
    });
    const decision = (await auditRows(t.db, proposal.id)).find(
      (a) => a.action === 'proposals.decided',
    );
    expect(decision?.metadata).toEqual({ decision: 'rejected', speciesId: null });
  });
});

describe('RFC-75 R5 listMyProposals', () => {
  const t = useTestApp();

  it("returns the proposer's rows in any status and nobody else's", async () => {
    const { user } = await createUser(t.db);
    const stranger = await createUser(t.db);
    const manager = await createUser(t.db);
    const open = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: user.id,
    });
    const rejected = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: user.id,
    });
    await rejectProposal(t.db, { id: rejected.id, note: 'No', actorId: manager.user.id });
    const someoneElse = await createProposal({ db: t.db, taxonomy: t.taxonomy }, UNRESTRICTED, {
      name: aName(),
      proposerId: stranger.user.id,
    });

    const { data } = await listMyProposals(t.db, user.id, { limit: 200 });
    const ids = data.map((p) => p.id);
    expect(ids).toEqual([rejected.id, open.id]);
    expect(ids).not.toContain(someoneElse.id);
  });
});

describe('RFC-81 R4 matchTaxon', () => {
  const t = useTestApp();

  it('answers the lookup the client produced', async () => {
    const name = aName();
    t.taxonomy.answers.set(name, exactLookup(name));
    expect(await matchTaxon({ taxonomy: t.taxonomy }, name)).toEqual(exactLookup(name));
  });

  it('throws TAXONOMY_LOOKUP_FAILED when the verdict is failed', async () => {
    await expect(
      matchTaxon({ taxonomy: { match: async () => failedLookup } }, aName()),
    ).rejects.toMatchObject({ code: 'TAXONOMY_LOOKUP_FAILED' });
  });
});

describe('RFC-75 R7 counts for the dashboard and the digest', () => {
  const t = useTestApp();

  it('countOpenProposals counts the open rows and drops one once it is decided', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const { user } = await createUser(tx);
      const manager = await createUser(tx);
      const before = await countOpenProposals(tx);

      const first = await createProposal({ db: tx, taxonomy: t.taxonomy }, UNRESTRICTED, {
        name: aName(),
        proposerId: user.id,
      });
      await createProposal({ db: tx, taxonomy: t.taxonomy }, UNRESTRICTED, {
        name: aName(),
        proposerId: user.id,
      });
      expect(await countOpenProposals(tx)).toBe(before + 2);

      await rejectProposal(tx, { id: first.id, note: 'No', actorId: manager.user.id });
      expect(await countOpenProposals(tx)).toBe(before + 1);
    });
  });

  it('countProposalsCreated counts the rows created inside the window only', async () => {
    await withRollback(t.db, async (tx) => {
      await freezeSnapshot(tx);
      const { user } = await createUser(tx);
      const start = new Date(Date.now() - 60_000);
      const before = await countProposalsCreated(tx, { start, end: new Date() });

      const created = await createProposal({ db: tx, taxonomy: t.taxonomy }, UNRESTRICTED, {
        name: aName(),
        proposerId: user.id,
      });
      expect(await countProposalsCreated(tx, { start, end: new Date(Date.now() + 60_000) })).toBe(
        before + 1,
      );

      // A window that closed a millisecond before the row was written counts
      // everything `before` counted and nothing more. The `start` is the same
      // one `before` used — widening it would pull in sibling suites' rows and
      // make the equality false while the code is right — and the frozen
      // snapshot is what makes the equality deterministic at all.
      const [row] = await tx
        .select({ createdAt: speciesProposals.createdAt })
        .from(speciesProposals)
        .where(eq(speciesProposals.id, created.id));
      const earlier = await countProposalsCreated(tx, {
        start,
        end: new Date((row?.createdAt.getTime() ?? 0) - 1),
      });
      expect(earlier).toBe(before);
    });
  });
});
