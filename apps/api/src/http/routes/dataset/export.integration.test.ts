import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  addPlotSpecies,
  assignPlots,
  createAnnotation,
  createFamily,
  createGenus,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createTrait,
  createVisibilityFixture,
} from '../../../../test/helpers/dataset.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';
import { traitLevels } from '../../../db/schema/dictionary.ts';

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

describe('RFC-66 R8 GET /api/export/records.csv', () => {
  const t = useTestApp();

  it('streams one CSV row per visible non-withdrawn record, ordered, quoted, with a BOM, and audits the download', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.export'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const family = await createFamily(t.db, {
      name: `Aaaceae-${Math.random().toString(16).slice(2)}`,
    });
    const genus = await createGenus(t.db, { familyId: family.id });
    const spA = await createSpecies(t.db, { genusId: genus.id });
    const spB = await createSpecies(t.db);
    const cat = await createTrait(t.db, { levels: ['red'] });
    const quant = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const ref = await createReference(t.db, {
      citationKey: `Smith, J. "et al." ${Math.random().toString(16).slice(2)}`,
    });
    const mk = (
      speciesId: string,
      traitId: string,
      v: { levelId?: string; numericValue?: number; valueText: string },
    ) =>
      createRecord(t.db, {
        speciesId,
        traitId,
        primaryReferenceId: ref.id,
        origin: 'manual',
        createdBy: user.id,
        ...v,
      });
    const a1 = await mk(spA.id, cat.id, { levelId: cat.levels[0]?.id, valueText: 'red' });
    const a2 = await mk(spA.id, quant.id, { numericValue: 12.5, valueText: '12.5' });
    const b1 = await mk(spB.id, quant.id, { numericValue: 2, valueText: '2' });
    const gone = await mk(spB.id, cat.id, { levelId: cat.levels[0]?.id, valueText: 'red' });
    await createAnnotation(t.db, { recordId: gone.id, actorId: user.id, kind: 'withdraw' });

    const res = await call(t.app, 'GET', '/api/export/records.csv', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="treerepro-records-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    // `Response.text()` strips a leading BOM; read the raw bytes (RFC-66 R4).
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    expect(text.startsWith('\uFEFF')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      'family,genus,species,name_source,category,trait,value,unit,level,numeric_value,raw_value,primary_reference,secondary_reference,origin,intent,created_at,record_id',
    );
    expect(lines[lines.length - 1]).toBe('');
    const rows = lines.slice(1, -1).map(parseLine);
    const byRecord = new Map(rows.map((r) => [r[16], r]));
    expect(byRecord.get(a1.id)).toEqual([
      family.name,
      genus.name,
      spA.canonicalName,
      'wcvp',
      expect.any(String),
      cat.key,
      'red',
      '',
      'red',
      '',
      '',
      ref.citationKey,
      '',
      'manual',
      '',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      a1.id,
    ]);
    expect(byRecord.get(a2.id)?.slice(6, 10)).toEqual(['12.5', 'mm', '', '12.5']);
    expect(byRecord.get(b1.id)?.[0]).toBe(''); // no family
    expect(byRecord.has(gone.id)).toBe(false); // withdrawn
    // Order: spA (family Aaaceae…) before spB (no family, nulls last); within spA by trait key.
    const mine = rows.filter((r) => [a1.id, a2.id, b1.id].includes(r[16] ?? '')).map((r) => r[16]);
    expect(mine.indexOf(a1.id)).toBeLessThan(mine.indexOf(b1.id));
    expect(mine.indexOf(a2.id)).toBeLessThan(mine.indexOf(b1.id));
    expect([...mine].slice(0, 2)).toEqual(cat.key < quant.key ? [a1.id, a2.id] : [a2.id, a1.id]);
    const audit = await lastAudit(t.db, 'dataset.exported', { actorUserId: user.id });
    expect(audit?.metadata).toEqual({ format: 'csv', scope: 'all' });
  });

  it('omits a row whose categorical level is invisible to the viewer', async () => {
    const unrestrictedRole = await createRole(t.db, {
      permissions: ['dataset.export', 'dataset.read_inactive'],
    });
    const restrictedRole = await createRole(t.db, { permissions: ['dataset.export'] });
    const { user: manager } = await createUser(t.db, { roles: [unrestrictedRole.id] });
    const { user: contributor } = await createUser(t.db, { roles: [restrictedRole.id] });
    const sp = await createSpecies(t.db);
    const trait = await createTrait(t.db, { levels: ['seen'] });
    const ref = await createReference(t.db);
    const record = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'seen',
      levelId: trait.levels[0]?.id,
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: manager.id,
    });
    // Deactivate the level: invisible to a viewer without dataset.read_inactive.
    await t.db
      .update(traitLevels)
      .set({ active: false })
      .where(eq(traitLevels.id, trait.levels[0]?.id as string));

    const recordIds = async (cookie: string) => {
      const res = await call(t.app, 'GET', '/api/export/records.csv', { cookie });
      expect(res.status).toBe(200);
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
      return text
        .slice(1)
        .split('\r\n')
        .slice(1, -1)
        .map((line) => parseLine(line)[16]);
    };

    const m = await recordIds((await loginAs(t, manager)).cookie);
    expect(m).toContain(record.id);

    const c = await recordIds((await loginAs(t, contributor)).cookie);
    expect(c).not.toContain(record.id);
  });

  it('RFC-33 R9 two viewers: a plot-bound viewer without dataset.read_inactive gets only the visible rows, an unrestricted viewer gets every row', async () => {
    const unrestrictedRole = await createRole(t.db, {
      permissions: ['dataset.export', 'dataset.read_inactive'],
    });
    const restrictedRole = await createRole(t.db, { permissions: ['dataset.export'] });
    const { user: manager } = await createUser(t.db, { roles: [unrestrictedRole.id] });
    const { user: contributor } = await createUser(t.db, { roles: [restrictedRole.id] });
    const f = await createVisibilityFixture(t.db, manager.id);
    // A fourth row: an active species on an active trait, outside the contributor's plot.
    const outsideSpecies = await createSpecies(t.db);
    const outsidePlot = await createRecord(t.db, {
      speciesId: outsideSpecies.id,
      traitId: f.activeTrait.id,
      valueText: 'one',
      levelId: f.activeTrait.levels[0]?.id,
      primaryReferenceId: f.reference.id,
      origin: 'manual',
      createdBy: manager.id,
    });
    const plot = await createPlot(t.db);
    await addPlotSpecies(t.db, plot.id, [f.shownSpecies.id, f.hiddenSpecies.id]);
    await assignPlots(t.db, contributor.id, [plot.id], true);
    const recordIds = async (cookie: string) => {
      const res = await call(t.app, 'GET', '/api/export/records.csv', { cookie });
      expect(res.status).toBe(200);
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
      return text
        .slice(1)
        .split('\r\n')
        .slice(1, -1)
        .map((line) => parseLine(line)[16]);
    };
    const all = [f.onHiddenSpecies.id, f.onInactiveTrait.id, f.visible.id, outsidePlot.id];

    const m = await recordIds((await loginAs(t, manager)).cookie);
    expect(all.filter((id) => m.includes(id))).toEqual(all);

    const c = await recordIds((await loginAs(t, contributor)).cookie);
    expect(all.filter((id) => c.includes(id))).toEqual([f.visible.id]);
  });

  it('RFC-33 R2 a dataset.export holder without records.review does not get a pending record row; one with records.review does', async () => {
    const reviewerRole = await createRole(t.db, {
      permissions: ['dataset.export', 'records.review'],
    });
    const exporterRole = await createRole(t.db, { permissions: ['dataset.export'] });
    const { user: reviewer } = await createUser(t.db, { roles: [reviewerRole.id] });
    const { user: exporter } = await createUser(t.db, { roles: [exporterRole.id] });
    const sp = await createSpecies(t.db);
    const trait = await createTrait(t.db, { valueType: 'quantitative', unit: 'mm' });
    const ref = await createReference(t.db);
    const pending = await createRecord(t.db, {
      speciesId: sp.id,
      traitId: trait.id,
      valueText: 'not a number',
      harmonisation: 'not_numeric',
      primaryReferenceId: ref.id,
      origin: 'manual',
      createdBy: reviewer.id,
    });

    const recordIds = async (cookie: string) => {
      const res = await call(t.app, 'GET', '/api/export/records.csv', { cookie });
      expect(res.status).toBe(200);
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
      return text
        .slice(1)
        .split('\r\n')
        .slice(1, -1)
        .map((line) => parseLine(line)[16]);
    };

    const withoutReview = await recordIds((await loginAs(t, exporter)).cookie);
    expect(withoutReview).not.toContain(pending.id);

    const withReview = await recordIds((await loginAs(t, reviewer)).cookie);
    expect(withReview).toContain(pending.id);
  });

  it('R7 an unauthenticated request keeps the JSON error envelope', async () => {
    const res = await call(t.app, 'GET', '/api/export/records.csv');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });
});
