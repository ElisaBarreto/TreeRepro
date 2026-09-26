import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  healthImportSchema,
  healthResponseSchema,
  JOB_STATUSES,
  jobRunSummarySchema,
  platformHealthSchema,
} from './health.ts';

const uuid = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';

describe('RFC-10 R10 healthResponseSchema', () => {
  it('accepts only { ok: true }', () => {
    expect(healthResponseSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(healthResponseSchema.safeParse({ ok: false }).success).toBe(false);
  });
});

describe('RFC-74 R1 JOB_STATUSES', () => {
  it('lists the four statuses a job_runs row can carry', () => {
    expect(JOB_STATUSES).toEqual(['running', 'completed', 'failed', 'skipped']);
  });
});

const jobRun = {
  startedAt: '2026-09-19T00:00:00.000Z',
  finishedAt: '2026-09-19T00:01:00.000Z',
  status: 'completed',
  detail: { phase: 'sending' },
  error: null,
};

describe('RFC-52 R1 jobRunSummarySchema', () => {
  it('accepts the newest job_runs row shape and rejects extras', () => {
    expect(jobRunSummarySchema.parse(jobRun)).toEqual(jobRun);
    expect(jobRunSummarySchema.safeParse({ ...jobRun, extra: 1 }).success).toBe(false);
    expect(jobRunSummarySchema.safeParse({ ...jobRun, status: 'queued' }).success).toBe(false);
  });

  it('accepts an empty detail record and a null finishedAt/error (a run still open or bare)', () => {
    expect(
      jobRunSummarySchema.safeParse({ ...jobRun, finishedAt: null, error: null, detail: {} })
        .success,
    ).toBe(true);
  });
});

const healthImport = {
  id: uuid,
  fileName: 'sample.csv',
  fileSha256: 'a'.repeat(64),
  status: 'completed',
  kind: 'records',
  startedAt: '2026-09-13T00:00:00.000Z',
  finishedAt: '2026-09-13T00:01:00.000Z',
  rowsTotal: 10,
  rowsInserted: 8,
  rowsDuplicate: 1,
  rowsRejected: 1,
  rowsPending: 2,
  rowsAlreadyImported: 0,
  unknownLevels: [{ trait: 'pollinator_group', value: 'bees', count: 2 }],
  error: null,
};

describe('RFC-52 R1, R2 healthImportSchema', () => {
  it('is the RFC-64 R11 import batch item without runBy', () => {
    expect(healthImportSchema.parse(healthImport)).toEqual(healthImport);
    expect(
      healthImportSchema.safeParse({ ...healthImport, runBy: { id: uuid, name: 'Ada' } }).success,
    ).toBe(false);
  });
});

const byDay = { day: '2026-09-05', records: 3, annotations: 1 };

const health = {
  users: { active: 10, invited: 2, suspended: 1, signedInLast7d: 5, signedInLast30d: 8 },
  dataset: {
    species: 100,
    activeSpecies: 90,
    traits: 20,
    activeTraits: 18,
    references: 40,
    records: 900,
    coverageCells: 500,
    validatedCells: 300,
  },
  activity: {
    records7d: 30,
    annotations7d: 10,
    proposals7d: 2,
    byDay: Array.from({ length: 14 }, (_, i) => ({
      ...byDay,
      day: `2026-09-${String(i + 1).padStart(2, '0')}`,
    })),
  },
  queues: { pendingGroups: 3, contested: 0, proposals: 4 },
  jobs: { auditPurge: jobRun, digest: null },
  imports: [healthImport],
  computedAt: '2026-09-19T00:00:00.000Z',
};

describe('RFC-52 R1 platformHealthSchema', () => {
  it('accepts the documented shape and rejects extras', () => {
    expect(platformHealthSchema.parse(health)).toEqual(health);
    expect(platformHealthSchema.safeParse({ ...health, extra: 1 }).success).toBe(false);
  });

  it('R1 activity.byDay is exactly 14 days', () => {
    expect(
      platformHealthSchema.safeParse({
        ...health,
        activity: { ...health.activity, byDay: health.activity.byDay.slice(0, 13) },
      }).success,
    ).toBe(false);
  });

  it('R1 imports holds at most 5 items', () => {
    const imports = Array.from({ length: 6 }, () => healthImport);
    expect(platformHealthSchema.safeParse({ ...health, imports }).success).toBe(false);
  });

  it('R1 both jobs may be null (never ran)', () => {
    expect(
      platformHealthSchema.safeParse({ ...health, jobs: { auditPurge: null, digest: null } })
        .success,
    ).toBe(true);
  });
});

/**
 * Walks a Zod schema's key paths without evaluating any value: every object
 * key, unwrapping arrays, nullable/optional/default wrappers and a
 * `z.record`'s value type, so a nested PII field could not hide behind any
 * of those. A `z.record` (like `detail`) has no fixed keys, so it recurses
 * into its value schema only, never enumerating keys.
 */
function collectKeyPaths(schema: z.ZodType, path: string[], out: string[][]): void {
  const def = schema.def as {
    type: string;
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
    innerType?: z.ZodType;
    valueType?: z.ZodType;
  };
  switch (def.type) {
    case 'object': {
      const shape = def.shape ?? {};
      for (const [key, child] of Object.entries(shape)) {
        const next = [...path, key];
        out.push(next);
        collectKeyPaths(child, next, out);
      }
      return;
    }
    case 'array':
      if (def.element) collectKeyPaths(def.element, path, out);
      return;
    case 'nullable':
    case 'optional':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
      if (def.innerType) collectKeyPaths(def.innerType, path, out);
      return;
    case 'record':
      if (def.valueType) collectKeyPaths(def.valueType, path, out);
      return;
    default:
      return;
  }
}

describe('RFC-52 R2 no PII in the health payload', () => {
  it('walks every key path (objects, arrays, nullables, the detail record) without a name, email, ip or userAgent field', () => {
    const forbidden = new Set(['name', 'email', 'ip', 'userAgent']);
    const paths: string[][] = [];
    for (const [key, child] of Object.entries(platformHealthSchema.shape)) {
      paths.push([key]);
      collectKeyPaths(child, [key], paths);
    }
    // Known DEEP paths, not a count. A count cannot tell a walk from a
    // shallow one: stop descending into arrays and nullables and the walk
    // still yields thirty paths (measured), so any threshold this schema
    // could plausibly carry is met by a walker that never reaches
    // `imports.*` or `jobs.<kind>.*` — exactly where a PII field would hide.
    // These four pin one descent each: into an object, into an array's
    // element, through a nullable's inner type, and into an array nested in
    // an array's element.
    const joined = paths.map((path) => path.join('.'));
    expect(joined).toContain('imports.fileName');
    expect(joined).toContain('jobs.digest.status');
    expect(joined).toContain('activity.byDay.day');
    expect(joined).toContain('imports.unknownLevels.trait');
    for (const path of paths) {
      const last = path[path.length - 1] as string;
      expect(forbidden.has(last)).toBe(false);
    }
  });
});
