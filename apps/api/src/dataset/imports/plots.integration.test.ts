import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { createPlot, createSpecies } from '../../../test/helpers/dataset.ts';
import { useTestDb } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { auditLog } from '../../db/schema/audit-log.ts';
import { importBatches, importRejects } from '../../db/schema/imports.ts';
import { plotSpecies, plots, userPlots } from '../../db/schema/plots.ts';
import { runSupplementaryImport } from './framework.ts';
import { importPlotSpecies, importPlots, importUserPlots, USER_PLOTS_HEADER } from './plots.ts';

async function csv(lines: string[], eol = '\n'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plots-import-'));
  const file = join(dir, 'import.csv');
  await writeFile(file, `${lines.join(eol)}${eol}`);
  return file;
}

describe('RFC-68 R9 import:plots', () => {
  const t = useTestDb();

  it('inserts missing plots, counts duplicates, rejects bad coordinates, audits the batch', async () => {
    const { user } = await createUser(t.db);
    const codeA = `p-a-${Date.now()}`;
    const codeB = `p-b-${Date.now()}`;
    const file = await csv([
      'plot_id,name,description,latitude,longitude,country,biome',
      `${codeA},Plot Alpha,Alpha description,12.34,-56.78,Brazil,Amazon`,
      `${codeB},Plot Beta,,,,,`,
      `bad-lat,Bad Lat,,north,-56.78,Brazil,Amazon`,
      `out-lat,Out Lat,,95,-56.78,Brazil,Amazon`,
    ]);

    const batch = await importPlots(t.db, { filePath: file, runBy: user.id });
    expect(batch.kind).toBe('plots');
    expect(batch.status).toBe('completed');
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      4, 2, 0, 2,
    ]);

    const rows = await t.db.select().from(plots).where(eq(plots.code, codeA));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Plot Alpha');
    expect(rows[0]?.latitude).toBeCloseTo(12.34);
    expect(rows[0]?.longitude).toBeCloseTo(-56.78);

    const rejects = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(rejects.map((r) => [r.rowNo, r.reason]).sort()).toEqual([
      [3, 'invalid_value'],
      [4, 'invalid_value'],
    ]);

    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.targetId, batch.id));
    expect(entry?.action).toBe('imports.completed');
    expect(entry?.metadata).toMatchObject({ kind: 'plots', rowsInserted: 2 });

    // Second run: existing code with a different name is a duplicate (not updated)
    const file2 = await csv([
      'plot_id,name,description,latitude,longitude,country,biome',
      `${codeA},Plot Alpha Changed,Alpha description,12.34,-56.78,Brazil,Amazon`,
      `${codeB},Plot Beta Changed,,,,,`,
    ]);
    const again = await importPlots(t.db, { filePath: file2, runBy: user.id });
    expect([again.rowsTotal, again.rowsInserted, again.rowsDuplicate, again.rowsRejected]).toEqual([
      2, 0, 2, 0,
    ]);
    const [unchanged] = await t.db.select().from(plots).where(eq(plots.code, codeA));
    expect(unchanged?.name).toBe('Plot Alpha');
  });
});

describe('RFC-68 R10 import:plot-species', () => {
  const t = useTestDb();

  it('associates species to plots, rejects unknown plot/species, treats existing pair as duplicate', async () => {
    const { user } = await createUser(t.db);
    const plot = await createPlot(t.db, { code: `ps-plot-${Date.now()}` });
    const sp1 = await createSpecies(t.db);
    const sp2 = await createSpecies(t.db);

    // Pre-insert one association
    await t.db.insert(plotSpecies).values({ plotId: plot.id, speciesId: sp1.id });

    const file = await csv([
      'plot_id,wcvp_species',
      `${plot.code},${sp1.canonicalName}`,
      `${plot.code},${sp2.canonicalName}`,
      `unknown-plot-code,${sp1.canonicalName}`,
      `${plot.code},Unknown Species Nonexistent`,
    ]);

    const batch = await importPlotSpecies(t.db, { filePath: file, runBy: user.id });
    expect(batch.kind).toBe('plot_species');
    expect(batch.status).toBe('completed');
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      4, 1, 1, 2,
    ]);

    const rejects = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(rejects.map((r) => [r.rowNo, r.reason]).sort()).toEqual([
      [3, 'unknown_plot'],
      [4, 'unknown_species'],
    ]);

    const members = await t.db.select().from(plotSpecies).where(eq(plotSpecies.plotId, plot.id));
    expect(members).toHaveLength(2);
  });
});

describe('RFC-68 R11 import:user-plots', () => {
  const t = useTestDb();

  it('assigns plots to users via blind index, accepts invited users, rejects unknown user/plot', async () => {
    const { user: admin } = await createUser(t.db);
    const { user: regularUser } = await createUser(t.db);
    const { user: invitedUser } = await createUser(t.db, { status: 'invited' });
    const plotA = await createPlot(t.db, { code: `up-a-${Date.now()}` });
    const plotB = await createPlot(t.db, { code: `up-b-${Date.now()}` });

    // Pre-assign regularUser to plotA
    await t.db.insert(userPlots).values({ userId: regularUser.id, plotId: plotA.id });

    const file = await csv([
      'user_email,plot_id',
      `${regularUser.email},${plotA.code}`,
      `${regularUser.email},${plotB.code}`,
      `${invitedUser.email},${plotA.code}`,
      `unknown-email-${Date.now()}@example.com,${plotA.code}`,
      `${regularUser.email},unknown-plot-code`,
    ]);

    const batch = await importUserPlots(t.db, { filePath: file, runBy: admin.id });
    expect(batch.kind).toBe('user_plots');
    expect(batch.status).toBe('completed');
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      5, 2, 1, 2,
    ]);

    const rejects = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(rejects.map((r) => [r.rowNo, r.reason]).sort()).toEqual([
      [4, 'unknown_user'],
      [5, 'unknown_plot'],
    ]);

    // Verify rejects do NOT persist plaintext email (RFC-40 R1)
    const unknownUserReject = rejects.find((r) => r.reason === 'unknown_user');
    expect(unknownUserReject?.rawRow.user_email).not.toContain(`unknown-email-`);
    expect(unknownUserReject?.rawRow.user_email).toBe('***');
    const unknownPlotReject = rejects.find((r) => r.reason === 'unknown_plot');
    expect(unknownPlotReject?.rawRow.user_email).toBe('***');

    // Check assignments
    const regAssignments = await t.db
      .select()
      .from(userPlots)
      .where(eq(userPlots.userId, regularUser.id));
    expect(regAssignments).toHaveLength(2);

    const invAssignments = await t.db
      .select()
      .from(userPlots)
      .where(eq(userPlots.userId, invitedUser.id));
    expect(invAssignments).toHaveLength(1);
    expect(invAssignments[0]?.plotId).toBe(plotA.id);
  });
});

describe('RFC-68 R11 migration 0041', () => {
  const t = useTestDb();

  it('redacts the e-mail of rejects written with the old partial mask', async () => {
    const { user } = await createUser(t.db);
    const plot = await createPlot(t.db);
    const file = await csv(['user_email,plot_id', `ghost-${Date.now()}@example.com,${plot.code}`]);
    const batch = await importUserPlots(t.db, { filePath: file, runBy: user.id });
    await t.db
      .update(importRejects)
      .set({ rawRow: { user_email: 'g***@example.com', plot_id: plot.code } })
      .where(eq(importRejects.batchId, batch.id));

    const [failedBatch, otherBatch] = await t.db
      .insert(importBatches)
      .values([
        {
          fileName: 'legacy.csv',
          fileSha256: 'x',
          kind: 'user_plots',
          status: 'failed',
          error: 'missing data — COPY import_staging, line 2: "old@example.com"',
        },
        {
          fileName: 'legacy.csv',
          fileSha256: 'y',
          kind: 'species_status',
          status: 'failed',
          error: 'bad — COPY import_staging, line 2: "Testus,maybe"',
        },
      ])
      .returning();
    if (!failedBatch || !otherBatch) throw new Error('batch insert returned no row');

    const migration = await readFile(
      new URL('../../../drizzle/0041_reject_email_redaction.sql', import.meta.url),
      'utf8',
    );
    await t.db.execute(sql.raw(migration));

    const [reject] = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(reject?.rawRow).toEqual({ user_email: '***', plot_id: plot.code });
    const [failed] = await t.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, failedBatch.id));
    expect(failed?.error).toBe('missing data — COPY import_staging, line 2');
    const [other] = await t.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, otherBatch.id));
    expect(other?.error).toBe('bad — COPY import_staging, line 2: "Testus,maybe"');
  });

  it('stores a failed batch error without the quoted row, keeping the line number', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'plots-import-')), `fail-${Date.now()}.csv`);
    await writeFile(file, 'user_email,plot_id\nalice-copy@uni.org,X\n');
    const failure = new postgres.PostgresError({
      message: 'missing data for column "plot_id"',
      where: 'COPY import_staging, line 2: "alice-copy@uni.org"',
    } as never);
    await expect(
      runSupplementaryImport(t.db, {
        kind: 'user_plots',
        header: USER_PLOTS_HEADER,
        filePath: file,
        runBy: null,
        apply: async () => {
          throw failure;
        },
      }),
    ).rejects.toThrow();
    const [batch] = await t.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.fileName, basename(file)));
    expect(batch?.error).toBe('missing data for column "plot_id" — COPY import_staging, line 2');
  });

  it('keeps a blank e-mail cell blank in the reject', async () => {
    const plot = await createPlot(t.db);
    const batch = await importUserPlots(t.db, {
      filePath: await csv(['user_email,plot_id', `,${plot.code}`]),
      runBy: null,
    });
    const [reject] = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(reject?.rawRow).toEqual({ user_email: '', plot_id: plot.code });
  });
});
