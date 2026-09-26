import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../../test/helpers/app.ts';
import { lastAudit } from '../../../../test/helpers/audit.ts';
import {
  addPlotSpecies,
  assignPlots,
  createImportBatch,
  createPlot,
  createRecord,
  createReference,
  createSpecies,
  createVisibilityFixture,
} from '../../../../test/helpers/dataset.ts';
import { exportScene, parseCsv, unzip } from '../../../../test/helpers/export.ts';
import { createRole } from '../../../../test/helpers/roles.ts';
import { loginAs } from '../../../../test/helpers/session.ts';
import { createUser } from '../../../../test/helpers/users.ts';

describe('RFC-66 GET /api/export/dataset.zip', () => {
  const t = useTestApp();

  it('R1, R4, R6 streams the ZIP with its headers, audits the download, and names no e-mail', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.export', 'records.review'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const s = await exportScene(t.db);

    const res = await call(t.app, 'GET', '/api/export/dataset.zip', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="treerepro-dataset-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    const files = await unzip(await res.arrayBuffer());
    expect([...files.keys()]).toEqual(['records.csv', 'annotations.csv']);
    const codes = parseCsv(files.get('records.csv') ?? '').rows.map((r) => r[0]);
    expect(codes).toContain(s.code.r1);
    expect(codes).toContain(s.code.p); // records.review: pending included (spec R-14)
    expect(codes).not.toContain(s.code.w); // withdrawn (spec R-13)
    const annotations = parseCsv(files.get('annotations.csv') ?? '');
    expect(annotations.rows.map((r) => r[0])).toContain(s.code.r1);
    expect(files.get('annotations.csv')).not.toContain(s.val1Email);
    const audit = await lastAudit(t.db, 'dataset.exported', { actorUserId: user.id });
    expect(audit?.metadata).toEqual({ format: 'zip', scope: 'all' });
  });

  it('R9 ?scope=platform names the platform file, audits the scope, and leaves the EB_ records out', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.export'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const s = await exportScene(t.db);
    const batch = await createImportBatch(t.db);
    const importedRef = await createReference(t.db);
    const eb = `EB_7${Math.floor(Math.random() * 1e12)}`;
    await t.db.execute(sql`
      insert into trait_records (record_code, species_id, trait_id, level_id, value_text,
        harmonisation, origin, import_batch_id, import_row_no, primary_reference_id)
      values (${eb}, ${s.sp.id}, ${s.cat.id}, ${s.red}, 'red', 'harmonised', 'import',
        ${batch.id}, 1, ${importedRef.id})`);

    const res = await call(t.app, 'GET', '/api/export/dataset.zip?scope=platform', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="treerepro-platform-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = await unzip(await res.arrayBuffer());
    const codes = parseCsv(files.get('records.csv') ?? '').rows.map((r) => r[0]);
    expect(codes).toContain(s.code.r1);
    expect(codes.some((c) => c?.startsWith('EB_'))).toBe(false);
    const audit = await lastAudit(t.db, 'dataset.exported', { actorUserId: user.id });
    expect(audit?.metadata).toEqual({ format: 'zip', scope: 'platform' });
  });

  it('R7 an unknown scope is a 400 VALIDATION_FAILED naming scope', async () => {
    const role = await createRole(t.db, { permissions: ['dataset.export'] });
    const { user } = await createUser(t.db, { roles: [role.id] });
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'GET', '/api/export/dataset.zip?scope=bogus', { cookie });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.map((d: { path: string }) => d.path)).toEqual(['scope']);
  });

  it('RFC-33 R9, RFC-66 R2 a plot-bound viewer without records.review gets only the visible, harmonised rows', async () => {
    const managerRole = await createRole(t.db, {
      permissions: ['dataset.export', 'dataset.read_inactive', 'records.review'],
    });
    const contributorRole = await createRole(t.db, { permissions: ['dataset.export'] });
    const { user: manager } = await createUser(t.db, { roles: [managerRole.id] });
    const { user: contributor } = await createUser(t.db, { roles: [contributorRole.id] });
    const f = await createVisibilityFixture(t.db, manager.id);
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
    const pending = await createRecord(t.db, {
      speciesId: f.shownSpecies.id,
      traitId: f.activeTrait.id,
      valueText: 'uno',
      primaryReferenceId: f.reference.id,
      origin: 'manual',
      createdBy: manager.id,
    });
    const plot = await createPlot(t.db);
    await addPlotSpecies(t.db, plot.id, [f.shownSpecies.id, f.hiddenSpecies.id]);
    await assignPlots(t.db, contributor.id, [plot.id], true);
    const ids = [
      f.onHiddenSpecies.id,
      f.onInactiveTrait.id,
      f.visible.id,
      outsidePlot.id,
      pending.id,
    ];
    const codes = await t.db.execute<{ id: string; record_code: string }>(
      sql`select id, record_code from trait_records where id in ${ids}`,
    );
    const codeOf = new Map(codes.map((r) => [r.id, r.record_code]));
    const exported = async (cookie: string) => {
      const res = await call(t.app, 'GET', '/api/export/dataset.zip', { cookie });
      expect(res.status).toBe(200);
      const files = await unzip(await res.arrayBuffer());
      const got = new Set(parseCsv(files.get('records.csv') ?? '').rows.map((r) => r[0]));
      return ids.filter((id) => got.has(codeOf.get(id) ?? ''));
    };

    expect(await exported((await loginAs(t, manager)).cookie)).toEqual(ids);
    expect(await exported((await loginAs(t, contributor)).cookie)).toEqual([f.visible.id]);
  });

  it('R7 an unauthenticated request keeps the JSON error envelope', async () => {
    const res = await call(t.app, 'GET', '/api/export/dataset.zip');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('R1 without dataset.export the answer is 403', async () => {
    const { user } = await createUser(t.db);
    const { cookie } = await loginAs(t, user);
    const res = await call(t.app, 'GET', '/api/export/dataset.zip', { cookie });
    expect(res.status).toBe(403);
  });
});
