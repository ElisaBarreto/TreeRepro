import { buffer } from 'node:stream/consumers';
import { sql } from 'drizzle-orm';
import { fromBufferPromise } from 'yauzl';
import type { Db } from '../../src/db/client.ts';
import {
  createAnnotation,
  createContest,
  createContestEvent,
  createFamily,
  createGenus,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
} from './dataset.ts';
import { createUser } from './users.ts';

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** A stream's bytes as text. `Response.text()` would strip the BOM the export writes (RFC-66 R4). */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return decoder.decode(await new Response(stream).arrayBuffer());
}

/** RFC 4180 line → fields (quotes doubled inside quoted fields). */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** One export CSV: BOM flag, the header line, and the data rows (the fixtures hold no line breaks). */
export function parseCsv(text: string): { bom: boolean; header: string; rows: string[][] } {
  const bom = text.startsWith('\uFEFF');
  const lines = (bom ? text.slice(1) : text).split('\r\n');
  if (lines.at(-1) !== '') throw new Error('the CSV does not end with CRLF');
  return { bom, header: lines[0] ?? '', rows: lines.slice(1, -1).map(parseLine) };
}

/** Every entry of a ZIP, in archive order, as text with the BOM kept. */
export async function unzip(bytes: ArrayBuffer | Uint8Array): Promise<Map<string, string>> {
  const zip = await fromBufferPromise(
    Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
  );
  const files = new Map<string, string>();
  for await (const entry of zip.eachEntry()) {
    files.set(entry.fileName, decoder.decode(await buffer(await zip.openReadStreamPromise(entry))));
  }
  return files;
}

export async function codeOf(db: Db, id: string): Promise<string> {
  const [row] = await db.execute<{ record_code: string }>(
    sql`select record_code from trait_records where id = ${id}`,
  );
  if (!row) throw new Error(`no record ${id}`);
  return row.record_code;
}

/**
 * One species, a categorical trait (red, blue) and a quantitative one:
 * - r1 red, two validators, an extra reference; r1b red; r2 blue;
 *   w red, validated then withdrawn; p pending (no level, raw `reddish`);
 *   r3 quantitative with all six value fields.
 * - k1 by Con Tester names red and created c1 (blue) and c1w (withdrawn);
 *   k2 by Con Two names blue and created nothing; k3 by Con Tester responds
 *   to r3 through c2 and is resolved (Keep both); k4 by Val Two names red and
 *   is withdrawn.
 * Every test owns its data.
 */
export async function exportScene(db: Db) {
  const family = await createFamily(db, { name: `Aaaceae-${Math.random().toString(16).slice(2)}` });
  const genus = await createGenus(db, { familyId: family.id });
  const sp = await createSpecies(db, { genusId: genus.id });
  const cat = await createTrait(db, { levels: ['red', 'blue'] });
  const quant = await createTrait(db, { valueType: 'quantitative', unit: 'mm' });
  const ref1 = await createReference(db, {
    citationKey: `Smith, J. "et al." ${Math.random().toString(16).slice(2)}`,
  });
  const ref2 = await createReference(db);
  const ref3 = await createReference(db);
  const { user: author } = await createUser(db, { name: 'Author One' });
  const { user: val1, email: val1Email } = await createUser(db, { name: 'Val One' });
  const { user: val2 } = await createUser(db, { name: 'Val Two' });
  const { user: contester } = await createUser(db, { name: 'Con Tester' });
  const { user: contester2 } = await createUser(db, { name: 'Con Two' });
  const red = cat.levels.find((l) => l.key === 'red')?.id as string;
  const blue = cat.levels.find((l) => l.key === 'blue')?.id as string;
  const mine = { speciesId: sp.id, origin: 'manual' as const, createdBy: author.id };
  const r1 = await createRecord(db, {
    ...mine,
    traitId: cat.id,
    levelId: red,
    valueText: 'red',
    primaryReferenceId: ref1.id,
  });
  await db.execute(
    sql`insert into record_references (record_id, reference_id) values (${r1.id}, ${ref2.id})`,
  );
  const r1b = await createRecord(db, {
    ...mine,
    traitId: cat.id,
    levelId: red,
    valueText: 'red',
    primaryReferenceId: ref3.id,
  });
  const r2 = await createRecord(db, {
    ...mine,
    traitId: cat.id,
    levelId: blue,
    valueText: 'blue',
    primaryReferenceId: ref1.id,
  });
  const w = await createRecord(db, {
    ...mine,
    traitId: cat.id,
    levelId: red,
    valueText: 'red',
    primaryReferenceId: ref2.id,
  });
  const p = await createRecord(db, {
    ...mine,
    traitId: cat.id,
    valueText: 'reddish',
    primaryReferenceId: ref1.id,
  });
  const r3 = await createRecord(db, {
    ...mine,
    traitId: quant.id,
    valueText: '12.5',
    numericValue: 12.5,
    minValue: 1,
    maxValue: 20,
    meanValue: 10,
    sdValue: 2.5,
    n: 8,
    primaryReferenceId: ref1.id,
  });
  const byContester = { speciesId: sp.id, origin: 'manual' as const, createdBy: contester.id };
  const c1 = await createRecord(db, {
    ...byContester,
    traitId: cat.id,
    levelId: blue,
    valueText: 'blue',
    primaryReferenceId: ref3.id,
    intent: 'contest' as const,
  });
  const c1w = await createRecord(db, {
    ...byContester,
    traitId: cat.id,
    levelId: blue,
    valueText: 'blue',
    primaryReferenceId: ref2.id,
    intent: 'contest' as const,
  });
  const c2 = await createRecord(db, {
    ...byContester,
    traitId: quant.id,
    numericValue: 99,
    valueText: '99',
    primaryReferenceId: ref1.id,
    intent: 'contest' as const,
    respondsToRecordId: r3.id,
  });
  const onCat = { speciesId: sp.id, traitId: cat.id };
  await createContest(db, {
    ...onCat,
    createdBy: contester.id,
    levelIds: [red],
    recordIds: [c1.id, c1w.id],
  });
  await createContest(db, { ...onCat, createdBy: contester2.id, levelIds: [blue] });
  const k3 = await createContest(db, {
    speciesId: sp.id,
    traitId: quant.id,
    createdBy: contester.id,
    recordIds: [c2.id],
  });
  await createContestEvent(db, { contestId: k3.id, actorId: val2.id, kind: 'resolve' });
  const k4 = await createContest(db, { ...onCat, createdBy: val2.id, levelIds: [red] });
  await createContestEvent(db, { contestId: k4.id, actorId: val2.id, kind: 'withdraw' });
  await createAnnotation(db, { recordId: c1w.id, actorId: contester.id, kind: 'withdraw' });
  await createAnnotation(db, { recordId: r1.id, actorId: val1.id, kind: 'confirm' });
  await createAnnotation(db, {
    recordId: r1.id,
    actorId: val2.id,
    kind: 'confirm',
    referenceId: ref2.id,
  });
  await createAnnotation(db, { recordId: w.id, actorId: val1.id, kind: 'confirm' });
  await createAnnotation(db, { recordId: w.id, actorId: author.id, kind: 'withdraw' });
  const ids = { r1, r1b, r2, w, p, r3, c1, c1w, c2 };
  const code = Object.fromEntries(
    await Promise.all(Object.entries(ids).map(async ([k, { id }]) => [k, await codeOf(db, id)])),
  ) as Record<keyof typeof ids, string>;
  return { family, genus, sp, cat, quant, ref1, ref2, ref3, val1Email, red, code };
}
