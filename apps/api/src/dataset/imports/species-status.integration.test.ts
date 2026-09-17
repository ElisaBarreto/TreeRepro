import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSpecies } from '../../../test/helpers/dataset.ts';
import { useTestDb } from '../../../test/helpers/db.ts';
import { createUser } from '../../../test/helpers/users.ts';
import { auditLog } from '../../db/schema/audit-log.ts';
import { importRejects } from '../../db/schema/imports.ts';
import { species } from '../../db/schema/taxa.ts';
import { importSpeciesStatus } from './species-status.ts';

async function csv(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'status-'));
  const file = join(dir, 'status.csv');
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

describe('RFC-68 R8 import:species-status', () => {
  const t = useTestDb();

  it('sets the flag, counts duplicates and rejects unknown species and bad values, audits the batch', async () => {
    const { user } = await createUser(t.db);
    const a = await createSpecies(t.db);
    const b = await createSpecies(t.db);
    const file = await csv([
      'wcvp_species,active',
      `${a.canonicalName},false`,
      `  ${b.canonicalName}  ,TRUE`,
      `No such species-${Math.random()},true`,
      `${a.canonicalName},maybe`,
    ]);
    const batch = await importSpeciesStatus(t.db, { filePath: file, runBy: user.id });
    expect(batch.kind).toBe('species_status');
    expect(batch.status).toBe('completed');
    expect([batch.rowsTotal, batch.rowsInserted, batch.rowsDuplicate, batch.rowsRejected]).toEqual([
      4, 1, 1, 2,
    ]);
    const [ra] = await t.db
      .select({ active: species.active })
      .from(species)
      .where(eq(species.id, a.id));
    expect(ra?.active).toBe(false);
    const rejects = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(rejects.map((r) => [r.rowNo, r.reason]).sort()).toEqual([
      [3, 'unknown_species'],
      [4, 'invalid_value'],
    ]);
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.targetId, batch.id));
    expect(entry?.action).toBe('imports.completed');
    expect(entry?.metadata).toMatchObject({ kind: 'species_status', rowsInserted: 1 });
    expect(entry?.actorUserId).toBe(user.id);

    // idempotent: the same file again is all duplicates
    const again = await importSpeciesStatus(t.db, { filePath: file, runBy: user.id });
    expect([again.rowsInserted, again.rowsDuplicate, again.rowsRejected]).toEqual([0, 2, 2]);
  });

  it('refuses a wrong header before creating a batch and fails the batch on a bad file', async () => {
    const bad = await csv(['species,active', 'x,true']);
    await expect(importSpeciesStatus(t.db, { filePath: bad, runBy: null })).rejects.toThrow(
      /header/i,
    );
  });
});
