import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useTestDb } from '../../../test/helpers/db.ts';
import { auditLog } from '../../db/schema/audit-log.ts';
import { importBatches, importRejects } from '../../db/schema/imports.ts';
import { runSupplementaryImport } from './framework.ts';
import { SPECIES_STATUS_HEADER } from './species-status.ts';

async function csv(lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'framework-'));
  const file = join(dir, `status-${randomBytes(4).toString('hex')}.csv`);
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

describe('RFC-68 R4 runSupplementaryImport failure path', () => {
  const t = useTestDb();

  it('rolls the transaction back and marks the batch failed when apply throws', async () => {
    const file = await csv(['wcvp_species,active', 'Testus specimen,true']);
    const fileName = file.split('/').pop() as string;

    await expect(
      runSupplementaryImport(t.db, {
        kind: 'species_status',
        header: SPECIES_STATUS_HEADER,
        filePath: file,
        runBy: null,
        apply: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');

    const [batch] = await t.db
      .select()
      .from(importBatches)
      .where(eq(importBatches.fileName, fileName));
    if (!batch) throw new Error('batch not found');
    expect(batch.status).toBe('failed');
    expect(batch.error).toContain('boom');
    expect(batch.finishedAt).not.toBeNull();

    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.targetId, batch.id));
    expect(entry).toBeUndefined();

    const rejects = await t.db
      .select()
      .from(importRejects)
      .where(eq(importRejects.batchId, batch.id));
    expect(rejects).toHaveLength(0);
  });
});
