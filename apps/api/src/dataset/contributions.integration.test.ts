import type { ContributionAnnotation, ContributionRecord } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import {
  createAcceptedValue,
  createAnnotation,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  createVisibilityFixture,
} from '../../test/helpers/dataset.ts';
import { useTestDb } from '../../test/helpers/db.ts';
import { createUser } from '../../test/helpers/users.ts';
import { RESTRICTED, UNRESTRICTED } from '../../test/helpers/visibility.ts';
import type { Visibility } from '../access/visibility.ts';
import type { Db } from '../db/client.ts';
import { contributionSummary, listContributions } from './contributions.ts';
import { ensurePersonalObservation } from './references.ts';

type Level = { id: string; key: string };
const level = (levels: Level[], key: string): string => {
  const found = levels.find((l) => l.key === key);
  if (!found) throw new Error(`level ${key} missing`);
  return found.id;
};

/** A species, a trait of its own and a reference; every test owns its data. */
async function scene(db: Db) {
  const [species, trait, reference] = await Promise.all([
    createSpecies(db),
    createTrait(db, { levels: ['alpha', 'beta', 'gamma'] }),
    createReference(db),
  ]);
  return { species, trait, reference };
}

const asRecords = (data: ContributionRecord[] | ContributionAnnotation[]): ContributionRecord[] =>
  data as ContributionRecord[];
const asAnnotations = (
  data: ContributionRecord[] | ContributionAnnotation[],
): ContributionAnnotation[] => data as ContributionAnnotation[];

const listRecordsOf = async (
  db: Db,
  visibility: Visibility,
  userId: string,
  input: Partial<Parameters<typeof listContributions>[3]> = {},
) => {
  const result = await listContributions(db, visibility, userId, {
    kind: 'records',
    limit: 50,
    ...input,
  });
  return { ...result, data: asRecords(result.data) };
};

describe('RFC-71 R2 listContributions kind=records', () => {
  const t = useTestDb();

  it('answers only the viewer own manual records, newest first, with a keyset cursor', async () => {
    const { user: a } = await createUser(t.db);
    const { user: b } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const other = await createReference(t.db);
    const mine = async (valueText: string) =>
      createRecord(t.db, {
        speciesId: species.id,
        traitId: trait.id,
        valueText,
        levelId: level(trait.levels, valueText),
        primaryReferenceId: reference.id,
        origin: 'manual',
        createdBy: a.id,
      });
    const a1 = await mine('alpha');
    const a2 = await mine('beta');
    const a3 = await mine('gamma');
    await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: other.id,
      origin: 'manual',
      createdBy: b.id,
    });

    const first = await listRecordsOf(t.db, UNRESTRICTED, a.id, { limit: 2 });
    expect(first.data.map((r) => r.id)).toEqual([a3.id, a2.id]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listRecordsOf(t.db, UNRESTRICTED, a.id, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.data.map((r) => r.id)).toEqual([a1.id]);
    expect(second.nextCursor).toBeNull();

    expect(second.data[0]).toEqual({
      id: a1.id,
      speciesId: species.id,
      species: { id: species.id, canonicalName: species.canonicalName },
      trait: { id: trait.id, key: trait.key, valueType: 'categorical', unit: null },
      valueText: 'alpha',
      level: { id: level(trait.levels, 'alpha'), key: 'alpha' },
      numericValue: null,
      harmonisation: 'harmonised',
      review: 'unreviewed',
      primaryReference: {
        id: reference.id,
        citationKey: reference.citationKey,
        kind: 'publication',
        observer: null,
        shortCitation: null,
      },
      secondaryReference: null,
      origin: 'manual',
      createdAt: expect.any(String),
      createdBy: { id: a.id, name: 'Test User' },
      intent: null,
      respondsTo: null,
      isAccepted: false,
      responseCount: 0,
    });
  });

  it('marks the record the latest accepted decision points at and counts its responses', async () => {
    const { user: a } = await createUser(t.db);
    const { user: curator } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const mine = async (valueText: string) =>
      createRecord(t.db, {
        speciesId: species.id,
        traitId: trait.id,
        valueText,
        levelId: level(trait.levels, valueText),
        primaryReferenceId: reference.id,
        origin: 'manual',
        createdBy: a.id,
      });
    const a1 = await mine('alpha');
    const a2 = await mine('beta');
    const accepted = async () => {
      const rows = await listRecordsOf(t.db, UNRESTRICTED, a.id);
      return Object.fromEntries(rows.data.map((r) => [r.id, r.isAccepted]));
    };

    expect(await accepted()).toEqual({ [a1.id]: false, [a2.id]: false });
    await createAcceptedValue(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      actorId: curator.id,
      recordId: a1.id,
    });
    expect(await accepted()).toEqual({ [a1.id]: true, [a2.id]: false });
    // Only the newest decision counts: the previous one must not keep a1 accepted.
    await createAcceptedValue(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      actorId: curator.id,
      recordId: a2.id,
    });
    expect(await accepted()).toEqual({ [a1.id]: false, [a2.id]: true });
    await createAcceptedValue(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      actorId: curator.id,
      decision: 'cleared',
    });
    expect(await accepted()).toEqual({ [a1.id]: false, [a2.id]: false });

    const { user: b } = await createUser(t.db);
    for (const [valueText, intent] of [
      ['beta', 'contest'],
      ['gamma', 'complement'],
    ] as const) {
      await createRecord(t.db, {
        speciesId: species.id,
        traitId: trait.id,
        valueText,
        levelId: level(trait.levels, valueText),
        primaryReferenceId: (await createReference(t.db)).id,
        origin: 'manual',
        createdBy: b.id,
        intent,
        respondsToRecordId: a1.id,
      });
    }
    const rows = await listRecordsOf(t.db, UNRESTRICTED, a.id);
    expect(rows.data.find((r) => r.id === a1.id)?.responseCount).toBe(2);
    expect(rows.data.find((r) => r.id === a2.id)?.responseCount).toBe(0);
  });

  it('filters by trait, by species and by review status', async () => {
    const { user: a } = await createUser(t.db);
    const { user: b } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const otherSpecies = await createSpecies(t.db);
    const otherTrait = await createTrait(t.db, { levels: ['alpha'] });
    const here = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: a.id,
    });
    const elsewhere = await createRecord(t.db, {
      speciesId: otherSpecies.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: a.id,
    });
    const otherTraitRecord = await createRecord(t.db, {
      speciesId: species.id,
      traitId: otherTrait.id,
      valueText: 'alpha',
      levelId: level(otherTrait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: a.id,
    });
    await createAnnotation(t.db, { recordId: elsewhere.id, actorId: b.id, kind: 'dispute' });

    const byTrait = await listRecordsOf(t.db, UNRESTRICTED, a.id, { traitId: otherTrait.id });
    expect(byTrait.data.map((r) => r.id)).toEqual([otherTraitRecord.id]);
    const bySpecies = await listRecordsOf(t.db, UNRESTRICTED, a.id, {
      speciesId: otherSpecies.id,
    });
    expect(bySpecies.data.map((r) => r.id)).toEqual([elsewhere.id]);
    const disputed = await listRecordsOf(t.db, UNRESTRICTED, a.id, { review: 'disputed' });
    expect(disputed.data.map((r) => r.id)).toEqual([elsewhere.id]);
    expect(disputed.data[0]?.review).toBe('disputed');
    const unreviewed = await listRecordsOf(t.db, UNRESTRICTED, a.id, { review: 'unreviewed' });
    expect(unreviewed.data.map((r) => r.id).sort()).toEqual([here.id, otherTraitRecord.id].sort());
  });

  it('filters by intent, where none means a record that answers nothing', async () => {
    const { user: a } = await createUser(t.db);
    const { user: b } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const plain = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
    });
    const responses: Record<string, string> = {};
    for (const [valueText, intent] of [
      ['beta', 'contest'],
      ['gamma', 'complement'],
    ] as const) {
      const row = await createRecord(t.db, {
        speciesId: species.id,
        traitId: trait.id,
        valueText,
        levelId: level(trait.levels, valueText),
        primaryReferenceId: reference.id,
        origin: 'manual',
        createdBy: a.id,
        intent,
        respondsToRecordId: plain.id,
      });
      responses[intent] = row.id;
    }
    const own = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: (await createReference(t.db)).id,
      origin: 'manual',
      createdBy: a.id,
    });

    const contests = await listRecordsOf(t.db, UNRESTRICTED, a.id, { intent: 'contest' });
    expect(contests.data.map((r) => r.id)).toEqual([responses.contest]);
    expect(contests.data[0]?.respondsTo).toEqual({ id: plain.id });
    const complements = await listRecordsOf(t.db, UNRESTRICTED, a.id, { intent: 'complement' });
    expect(complements.data.map((r) => r.id)).toEqual([responses.complement]);
    const none = await listRecordsOf(t.db, UNRESTRICTED, a.id, { intent: 'none' });
    expect(none.data.map((r) => r.id)).toEqual([own.id]);
  });

  it('bounds from and to by inclusive UTC days', async () => {
    const { user: a } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const at = async (valueText: string, createdAt: string) =>
      createRecord(t.db, {
        speciesId: species.id,
        traitId: trait.id,
        valueText,
        levelId: level(trait.levels, valueText),
        primaryReferenceId: reference.id,
        origin: 'manual',
        createdBy: a.id,
        createdAt: new Date(createdAt),
      });
    const before = await at('alpha', '2024-05-09T23:59:59.999Z');
    const dayStart = await at('beta', '2024-05-10T00:00:00.000Z');
    const dayEnd = await at('gamma', '2024-05-10T23:59:59.999Z');

    const day = await listRecordsOf(t.db, UNRESTRICTED, a.id, {
      from: '2024-05-10',
      to: '2024-05-10',
    });
    expect(day.data.map((r) => r.id).sort()).toEqual([dayStart.id, dayEnd.id].sort());
    const fromOnly = await listRecordsOf(t.db, UNRESTRICTED, a.id, { from: '2024-05-10' });
    expect(fromOnly.data.map((r) => r.id)).not.toContain(before.id);
    const toOnly = await listRecordsOf(t.db, UNRESTRICTED, a.id, { to: '2024-05-09' });
    expect(toOnly.data.map((r) => r.id)).toEqual([before.id]);
    const empty = await listRecordsOf(t.db, UNRESTRICTED, a.id, {
      from: '2024-05-11',
      to: '2024-05-10',
    });
    expect(empty.data).toEqual([]);
  });

  // RFC-33 R9's two-viewer sweep for `responseCount`. The count is deliberately
  // NOT filtered by the viewer: RFC-71 R2 attaches no visibility clause to it,
  // and RFC-71 R4 already settles that a contributor's own numbers stay true
  // whatever they may currently see. `main`'s 1b1d18a pins the species detail's
  // counts the same way.
  //
  // A response can in fact never be hidden while the record it answers is
  // visible: `trait_records_response_check` (migration 0021, RFC-63 R2) refuses
  // an insert whose species or trait differs from its target's, and visibility
  // reads exactly those two rows. So the equality below is structural, and what
  // the second half pins is the part that could still drift — the count answers
  // for the record, not for the page: the query's own filters choose which of
  // the viewer's records are listed, never which responses are counted, and a
  // response by any author counts.
  it('counts every response for both viewers, whoever wrote it and whatever the query asks for', async () => {
    const { user: a } = await createUser(t.db);
    const { user: b } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const target = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: a.id,
      createdAt: new Date('2024-05-10T12:00:00.000Z'),
    });
    const byOther = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'beta',
      levelId: level(trait.levels, 'beta'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
      intent: 'contest',
      respondsToRecordId: target.id,
    });
    const bySelf = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'gamma',
      levelId: level(trait.levels, 'gamma'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: a.id,
      intent: 'complement',
      respondsToRecordId: target.id,
    });
    const countOf = (rows: { id: string; responseCount: number }[]) =>
      rows.find((r) => r.id === target.id)?.responseCount;

    const restricted = await listRecordsOf(t.db, RESTRICTED, a.id);
    const unrestricted = await listRecordsOf(t.db, UNRESTRICTED, a.id);
    expect(restricted.data.map((r) => r.id).sort()).toEqual([target.id, bySelf.id].sort());
    expect(countOf(restricted.data)).toBe(2);
    expect(countOf(unrestricted.data)).toBe(countOf(restricted.data));

    // The day bounds pick the listed record; the count still answers for every
    // response, including `byOther`, written by somebody else on another day.
    const onDay = await listRecordsOf(t.db, RESTRICTED, a.id, {
      from: '2024-05-10',
      to: '2024-05-10',
    });
    expect(onDay.data.map((r) => r.id)).toEqual([target.id]);
    expect(countOf(onDay.data)).toBe(2);
    // `byOther` is counted although it is B's record and never A's to list.
    expect(onDay.data.map((r) => r.id)).not.toContain(byOther.id);
  });
});

describe('RFC-71 R3 listContributions kind=annotations', () => {
  const t = useTestDb();

  it('answers the viewer own annotations newest first, each with its record and reference', async () => {
    const { user: a } = await createUser(t.db);
    const { user: b } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const cited = await createReference(t.db);
    const record = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
    });
    const second = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'beta',
      levelId: level(trait.levels, 'beta'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
    });
    const confirm = await createAnnotation(t.db, {
      recordId: record.id,
      actorId: a.id,
      kind: 'confirm',
      note: 'seen in the field',
      referenceId: cited.id,
    });
    const dispute = await createAnnotation(t.db, {
      recordId: second.id,
      actorId: a.id,
      kind: 'dispute',
      note: 'wrong level',
      generated: true,
    });
    await createAnnotation(t.db, { recordId: record.id, actorId: b.id, kind: 'neutral' });

    const page = await listContributions(t.db, UNRESTRICTED, a.id, {
      kind: 'annotations',
      limit: 1,
    });
    const rows = asAnnotations(page.data);
    expect(rows.map((r) => r.id)).toEqual([dispute.id]);
    expect(page.nextCursor).not.toBeNull();
    expect(rows[0]).toEqual({
      id: dispute.id,
      kind: 'dispute',
      note: 'wrong level',
      reference: null,
      generated: true,
      createdAt: expect.any(String),
      record: expect.objectContaining({ id: second.id, species: expect.any(Object) }),
    });

    const rest = asAnnotations(
      (
        await listContributions(t.db, UNRESTRICTED, a.id, {
          kind: 'annotations',
          limit: 10,
          cursor: page.nextCursor ?? undefined,
        })
      ).data,
    );
    expect(rest.map((r) => r.id)).toEqual([confirm.id]);
    expect(rest[0]?.reference).toEqual({
      id: cited.id,
      citationKey: cited.citationKey,
      kind: 'publication',
      observer: null,
      shortCitation: null,
    });
    expect(rest[0]?.generated).toBe(false);
    expect(rest[0]?.record.id).toBe(record.id);
  });

  it('RFC-61 R4, R7 an annotation citing a personal observation carries its observer', async () => {
    const { user: a } = await createUser(t.db);
    const { user: observer } = await createUser(t.db, {
      name: `Observer-${Math.random().toString(16).slice(2)}`,
    });
    const observation = await ensurePersonalObservation(t.db, observer.id);
    const { species, trait, reference } = await scene(t.db);
    const record = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: a.id,
    });
    await createAnnotation(t.db, {
      recordId: record.id,
      actorId: a.id,
      kind: 'confirm',
      note: 'seen it myself',
      referenceId: observation.id,
    });

    const page = await listContributions(t.db, UNRESTRICTED, a.id, {
      kind: 'annotations',
      limit: 10,
    });
    const rows = asAnnotations(page.data);
    expect(rows[0]?.reference).toEqual({
      id: observation.id,
      citationKey: `personal-observation:${observer.id}`,
      kind: 'personal_observation',
      observer: { id: observer.id, name: observer.name },
      shortCitation: null,
    });
  });

  it('applies the filters to the annotated record', async () => {
    const { user: a } = await createUser(t.db);
    const { user: b } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const otherTrait = await createTrait(t.db, { levels: ['alpha'] });
    const here = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
    });
    const elsewhere = await createRecord(t.db, {
      speciesId: species.id,
      traitId: otherTrait.id,
      valueText: 'alpha',
      levelId: level(otherTrait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
    });
    const onTrait = await createAnnotation(t.db, {
      recordId: here.id,
      actorId: a.id,
      kind: 'confirm',
    });
    await createAnnotation(t.db, { recordId: elsewhere.id, actorId: a.id, kind: 'confirm' });

    const filtered = await listContributions(t.db, UNRESTRICTED, a.id, {
      kind: 'annotations',
      traitId: trait.id,
      limit: 50,
    });
    expect(asAnnotations(filtered.data).map((r) => r.id)).toEqual([onTrait.id]);
  });

  it('bounds from and to by the annotated record day, not the annotation day', async () => {
    const { user: a } = await createUser(t.db);
    const { user: b } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const old = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
      createdAt: new Date('2024-05-10T12:00:00.000Z'),
    });
    const annotation = await createAnnotation(t.db, {
      recordId: old.id,
      actorId: a.id,
      kind: 'confirm',
    });

    const onDay = await listContributions(t.db, UNRESTRICTED, a.id, {
      kind: 'annotations',
      from: '2024-05-10',
      to: '2024-05-10',
      limit: 50,
    });
    expect(asAnnotations(onDay.data).map((r) => r.id)).toEqual([annotation.id]);
    const dayAfter = await listContributions(t.db, UNRESTRICTED, a.id, {
      kind: 'annotations',
      from: '2024-05-11',
      limit: 50,
    });
    expect(asAnnotations(dayAfter.data).map((r) => r.id)).not.toContain(annotation.id);
  });

  // R3's "the filters apply to the annotated record" covers `review` and
  // `intent` for annotations too, same as for records: the contract accepts
  // them with either kind, and a filter that silently did nothing would be
  // the worse trap.
  it('filters by review and by intent through the annotated record, none included', async () => {
    const { user: a } = await createUser(t.db);
    const { user: b } = await createUser(t.db);
    const { user: c } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const other = await createReference(t.db);
    const plain = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
    });
    const disputed = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'beta',
      levelId: level(trait.levels, 'beta'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
    });
    const contest = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'gamma',
      levelId: level(trait.levels, 'gamma'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
      intent: 'contest',
      respondsToRecordId: plain.id,
    });
    const complement = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: other.id,
      origin: 'manual',
      createdBy: b.id,
      intent: 'complement',
      respondsToRecordId: plain.id,
    });
    await createAnnotation(t.db, { recordId: disputed.id, actorId: c.id, kind: 'dispute' });
    const onPlain = await createAnnotation(t.db, {
      recordId: plain.id,
      actorId: a.id,
      kind: 'confirm',
    });
    const onDisputed = await createAnnotation(t.db, {
      recordId: disputed.id,
      actorId: a.id,
      kind: 'neutral',
    });
    const onContest = await createAnnotation(t.db, {
      recordId: contest.id,
      actorId: a.id,
      kind: 'confirm',
    });
    const onComplement = await createAnnotation(t.db, {
      recordId: complement.id,
      actorId: a.id,
      kind: 'confirm',
    });
    const ids = async (input: Partial<Parameters<typeof listContributions>[3]>) =>
      asAnnotations(
        (
          await listContributions(t.db, UNRESTRICTED, a.id, {
            kind: 'annotations',
            limit: 50,
            ...input,
          })
        ).data,
      ).map((r) => r.id);

    // The viewer's own stance never decides: the record C disputed is disputed,
    // although A's own annotation on it is neutral.
    expect(await ids({ review: 'disputed' })).toEqual([onDisputed.id]);
    expect(await ids({ review: 'confirmed' })).toEqual([onComplement.id, onContest.id, onPlain.id]);
    expect(await ids({ review: 'withdrawn' })).toEqual([]);
    expect(await ids({ intent: 'contest' })).toEqual([onContest.id]);
    expect(await ids({ intent: 'complement' })).toEqual([onComplement.id]);
    expect(await ids({ intent: 'none' })).toEqual([onDisputed.id, onPlain.id]);
  });
});

describe('RFC-71 R4 contributionSummary', () => {
  const t = useTestDb();

  it('counts records, intents, stances, withdrawals and accepted values', async () => {
    const { user: a } = await createUser(t.db);
    const { user: b } = await createUser(t.db);
    const { species, trait, reference } = await scene(t.db);
    const target = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'alpha',
      levelId: level(trait.levels, 'alpha'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: b.id,
    });
    // A's two manual records are both responses: one contest, one complement.
    const contest = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'beta',
      levelId: level(trait.levels, 'beta'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: a.id,
      intent: 'contest',
      respondsToRecordId: target.id,
    });
    const complement = await createRecord(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      valueText: 'gamma',
      levelId: level(trait.levels, 'gamma'),
      primaryReferenceId: reference.id,
      origin: 'manual',
      createdBy: a.id,
      intent: 'complement',
      respondsToRecordId: target.id,
    });
    for (let i = 0; i < 3; i++) {
      const confirmed = await createRecord(t.db, {
        speciesId: species.id,
        traitId: trait.id,
        valueText: `confirmed-${i}`,
        primaryReferenceId: reference.id,
        origin: 'manual',
        createdBy: b.id,
      });
      await createAnnotation(t.db, { recordId: confirmed.id, actorId: a.id, kind: 'confirm' });
    }
    await createAnnotation(t.db, { recordId: target.id, actorId: a.id, kind: 'dispute' });
    await createAnnotation(t.db, { recordId: contest.id, actorId: b.id, kind: 'withdraw' });
    await createAcceptedValue(t.db, {
      speciesId: species.id,
      traitId: trait.id,
      actorId: b.id,
      recordId: complement.id,
    });

    expect(await contributionSummary(t.db, a.id)).toEqual({
      records: 2,
      contests: 1,
      complements: 1,
      validations: 3,
      disputes: 1,
      withdrawn: 1,
      accepted: 1,
    });
    expect(await contributionSummary(t.db, (await createUser(t.db)).user.id)).toEqual({
      records: 0,
      contests: 0,
      complements: 0,
      validations: 0,
      disputes: 0,
      withdrawn: 0,
      accepted: 0,
    });
  });
});

describe('RFC-71 R2-R4 visibility', () => {
  const t = useTestDb();

  it('omits a record the viewer may no longer see but still counts it in the summary', async () => {
    const { user: a } = await createUser(t.db);
    const fixture = await createVisibilityFixture(t.db, a.id);

    const unrestricted = await listRecordsOf(t.db, UNRESTRICTED, a.id);
    expect(unrestricted.data.map((r) => r.id).sort()).toEqual(
      [fixture.onHiddenSpecies.id, fixture.onInactiveTrait.id, fixture.visible.id].sort(),
    );
    const restricted = await listRecordsOf(t.db, RESTRICTED, a.id);
    expect(restricted.data.map((r) => r.id)).toEqual([fixture.visible.id]);

    await createAnnotation(t.db, {
      recordId: fixture.onHiddenSpecies.id,
      actorId: a.id,
      kind: 'confirm',
    });
    const annotations = await listContributions(t.db, RESTRICTED, a.id, {
      kind: 'annotations',
      limit: 50,
    });
    expect(annotations.data).toEqual([]);

    // R4: the numbers stay true whatever the viewer may see.
    expect(await contributionSummary(t.db, a.id)).toEqual({
      records: 3,
      contests: 0,
      complements: 0,
      validations: 1,
      disputes: 0,
      withdrawn: 0,
      accepted: 0,
    });
  });
});
