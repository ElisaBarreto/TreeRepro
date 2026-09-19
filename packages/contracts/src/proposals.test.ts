import { describe, expect, it } from 'vitest';
import {
  approveProposalBodySchema,
  createProposalBodySchema,
  LOOKUP_VERDICTS,
  listProposalsQuerySchema,
  lookupSchema,
  PROPOSAL_STATUSES,
  proposalSchema,
  rejectProposalBodySchema,
  taxonMatchSchema,
  taxonomyMatchQuerySchema,
} from './proposals.ts';

const uuid = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d9e';

const match = {
  matchType: 'EXACT',
  confidence: 98,
  usageKey: '2878688',
  scientificName: 'Quercus robur L.',
  canonicalName: 'Quercus robur',
  rank: 'SPECIES',
  status: 'ACCEPTED',
  family: 'Fagaceae',
  genus: 'Quercus',
  acceptedUsageKey: null,
  note: null,
};

const proposal = {
  id: uuid,
  proposedName: 'Quercus robour',
  note: 'seen in plot 4',
  status: 'open',
  proposer: { id: uuid, name: 'Ada' },
  lookup: { backbone: match, wcvp: null, verdict: 'exact' },
  lookupAt: '2026-09-19T00:00:00.000Z',
  species: null,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  createdAt: '2026-09-19T00:00:00.000Z',
};

describe('RFC-75 R1 PROPOSAL_STATUSES', () => {
  it('holds exactly the three statuses the table CHECK constraint allows', () => {
    expect(PROPOSAL_STATUSES).toEqual(['open', 'approved', 'rejected']);
  });
});

describe('RFC-81 R3 LOOKUP_VERDICTS', () => {
  it('holds exactly the four verdicts the lookup can produce', () => {
    expect(LOOKUP_VERDICTS).toEqual(['exact', 'fuzzy', 'none', 'failed']);
  });
});

describe('RFC-81 R2 taxonMatchSchema', () => {
  it('accepts a full match, including VARIANT and a non-numeric usageKey', () => {
    expect(taxonMatchSchema.safeParse(match).success).toBe(true);
    expect(taxonMatchSchema.safeParse({ ...match, matchType: 'VARIANT' }).success).toBe(true);
    expect(taxonMatchSchema.safeParse({ ...match, usageKey: '4R5YN' }).success).toBe(true);
  });

  it('rejects a numeric usageKey — the v2 API sends a string (ruling R-B)', () => {
    expect(taxonMatchSchema.safeParse({ ...match, usageKey: 2878688 }).success).toBe(false);
    expect(taxonMatchSchema.safeParse({ ...match, acceptedUsageKey: 2878688 }).success).toBe(false);
  });

  it('rejects a matchType outside the enum, and rejects unknown extra fields', () => {
    expect(taxonMatchSchema.safeParse({ ...match, matchType: 'PARTIAL' }).success).toBe(false);
    expect(taxonMatchSchema.safeParse({ ...match, extra: 1 }).success).toBe(false);
  });

  it('accepts every documented nullable field as null', () => {
    const allNull = {
      matchType: 'NONE',
      confidence: null,
      usageKey: null,
      scientificName: null,
      canonicalName: null,
      rank: null,
      status: null,
      family: null,
      genus: null,
      acceptedUsageKey: null,
      note: null,
    };
    expect(taxonMatchSchema.safeParse(allNull).success).toBe(true);
  });
});

describe('RFC-81 R3 lookupSchema', () => {
  it('accepts nullable sources and a documented verdict', () => {
    expect(lookupSchema.safeParse({ backbone: match, wcvp: null, verdict: 'exact' }).success).toBe(
      true,
    );
    expect(lookupSchema.safeParse({ backbone: null, wcvp: null, verdict: 'failed' }).success).toBe(
      true,
    );
    expect(
      lookupSchema.safeParse({ backbone: match, wcvp: null, verdict: 'unknown' }).success,
    ).toBe(false);
  });
});

describe('RFC-75 R6 proposalSchema', () => {
  it('accepts the documented representation and rejects extras', () => {
    expect(proposalSchema.safeParse(proposal).success).toBe(true);
    expect(proposalSchema.safeParse({ ...proposal, lookup: null }).success).toBe(true);
    expect(
      proposalSchema.safeParse({
        ...proposal,
        status: 'approved',
        species: { id: uuid, canonicalName: 'Quercus robur' },
        decidedBy: { id: uuid, name: 'Manager' },
        decidedAt: '2026-09-19T01:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(proposalSchema.safeParse({ ...proposal, extra: 1 }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...proposal, status: 'pending' }).success).toBe(false);
  });
});

describe('RFC-75 R2 createProposalBodySchema', () => {
  it('trims and bounds name to 3-200, and note to 1-2000 when present', () => {
    expect(createProposalBodySchema.parse({ name: '  Quercus robour  ' })).toMatchObject({
      name: 'Quercus robour',
    });
    expect(createProposalBodySchema.safeParse({ name: 'Qu' }).success).toBe(false);
    expect(createProposalBodySchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
    expect(
      createProposalBodySchema.safeParse({ name: 'Quercus robour', note: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
    expect(createProposalBodySchema.safeParse({ name: 'Quercus robour', note: '' }).success).toBe(
      false,
    );
    expect(createProposalBodySchema.safeParse({ name: 'Quercus robour', extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('RFC-75 R3 listProposalsQuerySchema', () => {
  it('extends the cursor query with an optional status filter', () => {
    expect(listProposalsQuerySchema.parse({})).toMatchObject({ limit: 50 });
    expect(listProposalsQuerySchema.safeParse({ status: 'open' }).success).toBe(true);
    expect(listProposalsQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);
  });
});

describe('RFC-75 R4 approveProposalBodySchema', () => {
  it('requires canonicalName and nameSource; accepts optional genus/family/alternativeNames', () => {
    expect(
      approveProposalBodySchema.safeParse({ canonicalName: 'Quercus robur', nameSource: 'wcvp' })
        .success,
    ).toBe(true);
    expect(
      approveProposalBodySchema.safeParse({
        canonicalName: 'Quercus robur',
        nameSource: 'gbif',
        genusName: 'Quercus',
        familyName: 'Fagaceae',
        alternativeNames: [{ name: 'English oak', nameType: 'common', language: 'en' }],
      }).success,
    ).toBe(true);
    expect(approveProposalBodySchema.safeParse({ canonicalName: 'Quercus robur' }).success).toBe(
      false,
    );
    expect(
      approveProposalBodySchema.safeParse({ canonicalName: 'Quercus robur', nameSource: 'bogus' })
        .success,
    ).toBe(false);
    expect(
      approveProposalBodySchema.safeParse({
        canonicalName: 'Quercus robur',
        nameSource: 'wcvp',
        alternativeNames: Array.from({ length: 21 }, () => ({
          name: 'x',
          nameType: 'common',
          language: 'en',
        })),
      }).success,
    ).toBe(false);
  });
});

describe('RFC-75 R4 rejectProposalBodySchema', () => {
  it('requires a 1-2000 character note', () => {
    expect(rejectProposalBodySchema.safeParse({ note: 'not a real species here' }).success).toBe(
      true,
    );
    expect(rejectProposalBodySchema.safeParse({}).success).toBe(false);
    expect(rejectProposalBodySchema.safeParse({ note: '' }).success).toBe(false);
  });
});

describe('RFC-81 R4 taxonomyMatchQuerySchema', () => {
  it('trims and bounds name to 3-200', () => {
    expect(taxonomyMatchQuerySchema.parse({ name: '  Quercus robur  ' })).toMatchObject({
      name: 'Quercus robur',
    });
    expect(taxonomyMatchQuerySchema.safeParse({ name: 'Qu' }).success).toBe(false);
  });
});
