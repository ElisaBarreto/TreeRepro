import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  addPlotSpecies,
  assignPlots,
  createAcceptedValue,
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

describe('RFC-66 GET /api/export/accepted.csv', () => {
  const t = useTestApp();

  it('streams one CSV row per current accepted value, ordered, quoted, with a BOM, and audits the download', async () => {
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
    const b1 = await mk(spB.id, cat.id, { levelId: cat.levels[0]?.id, valueText: 'red' });
    const replaced = await mk(spB.id, quant.id, { numericValue: 1, valueText: '1' });
    const replacement = await mk(spB.id, quant.id, { numericValue: 2, valueText: '2' });
    await createAcceptedValue(t.db, {
      speciesId: spA.id,
      traitId: cat.id,
      recordId: a1.id,
      actorId: user.id,
    });
    await createAcceptedValue(t.db, {
      speciesId: spA.id,
      traitId: quant.id,
      recordId: a2.id,
      actorId: user.id,
    });
    await createAcceptedValue(t.db, {
      speciesId: spB.id,
      traitId: cat.id,
      recordId: b1.id,
      actorId: user.id,
    });
    await createAcceptedValue(t.db, {
      speciesId: spB.id,
      traitId: cat.id,
      actorId: user.id,
      decision: 'cleared',
      note: 'x',
    });
    await createAcceptedValue(t.db, {
      speciesId: spB.id,
      traitId: quant.id,
      recordId: replaced.id,
      actorId: user.id,
    });
    await createAcceptedValue(t.db, {
      speciesId: spB.id,
      traitId: quant.id,
      recordId: replacement.id,
      actorId: user.id,
    });

    const res = await call(t.app, 'GET', '/api/export/accepted.csv', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="treerepro-accepted-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    // `Response.text()` runs the Encoding Standard's "UTF-8 decode", which
    // strips a leading BOM; read the raw bytes instead so the BOM this
    // route writes for spreadsheet software (RFC-66 R5) is actually checked.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    expect(text.startsWith('\uFEFF')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      'family,genus,species,name_source,category,trait,value,unit,level,numeric_value,primary_reference,secondary_reference,decided_at,record_id',
    );
    expect(lines[lines.length - 1]).toBe('');
    const rows = lines.slice(1, -1).map(parseLine);
    const byRecord = new Map(rows.map((r) => [r[13], r]));
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
      ref.citationKey,
      '',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      a1.id,
    ]);
    expect(byRecord.get(a2.id)?.slice(6, 10)).toEqual(['12.5', 'mm', '', '12.5']);
    expect(byRecord.has(b1.id)).toBe(false); // cleared
    expect(byRecord.has(replaced.id)).toBe(false); // replaced
    expect(byRecord.get(replacement.id)?.[0]).toBe(''); // no family
    // R3 order: spA (family Aaaceae…) before spB (no family, nulls last); within spA by trait key
    const mine = rows
      .filter((r) => [a1.id, a2.id, replacement.id].includes(r[13] ?? ''))
      .map((r) => r[13]);
    expect(mine.indexOf(a1.id)).toBeLessThan(mine.indexOf(replacement.id));
    expect(mine.indexOf(a2.id)).toBeLessThan(mine.indexOf(replacement.id));
    expect([...mine].slice(0, 2)).toEqual(cat.key < quant.key ? [a1.id, a2.id] : [a2.id, a1.id]);
    const audit = await lastAudit(t.db, 'dataset.exported', { actorUserId: user.id });
    expect(audit?.metadata).toEqual({ format: 'csv', scope: 'accepted' });
  });

  it('RFC-33 R9, RFC-66 R2 two viewers: a plot-bound viewer without dataset.read_inactive gets only the visible rows, an unrestricted viewer gets every row', async () => {
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
    const accepted: [string, string, { id: string }][] = [
      [f.hiddenSpecies.id, f.activeTrait.id, f.onHiddenSpecies],
      [f.shownSpecies.id, f.inactiveTrait.id, f.onInactiveTrait],
      [f.shownSpecies.id, f.activeTrait.id, f.visible],
      [outsideSpecies.id, f.activeTrait.id, outsidePlot],
    ];
    for (const [speciesId, traitId, record] of accepted) {
      await createAcceptedValue(t.db, {
        speciesId,
        traitId,
        recordId: record.id,
        actorId: manager.id,
      });
    }
    const recordIds = async (cookie: string) => {
      const res = await call(t.app, 'GET', '/api/export/accepted.csv', { cookie });
      expect(res.status).toBe(200);
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
      return text
        .slice(1)
        .split('\r\n')
        .slice(1, -1)
        .map((line) => parseLine(line)[13]);
    };
    const all = [f.onHiddenSpecies.id, f.onInactiveTrait.id, f.visible.id, outsidePlot.id];

    const m = await recordIds((await loginAs(t, manager)).cookie);
    expect(all.filter((id) => m.includes(id))).toEqual(all);

    const c = await recordIds((await loginAs(t, contributor)).cookie);
    expect(all.filter((id) => c.includes(id))).toEqual([f.visible.id]);
  });

  it('R7 an unauthenticated request keeps the JSON error envelope', async () => {
    const res = await call(t.app, 'GET', '/api/export/accepted.csv');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });
});
