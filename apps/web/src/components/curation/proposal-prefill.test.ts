import { describe, expect, it } from 'vitest';
import {
  BACKBONE_MATCH,
  LOOKUP_EXACT,
  LOOKUP_FUZZY,
  LOOKUP_GENUS,
  LOOKUP_NONE,
  PROPOSAL,
  PROPOSAL_LOOKUP_FAILED,
  WCVP_MATCH,
} from '../../test/dataset-fixtures.ts';
import { proposalPrefill } from './proposal-prefill.ts';

describe('RFC-75 R4 proposalPrefill', () => {
  it('takes the canonical name from WCVP when the verdict is exact', () => {
    expect(proposalPrefill(PROPOSAL)).toEqual({
      canonicalName: 'Quercus robur',
      nameSource: 'wcvp',
      genusName: 'Quercus',
      familyName: 'Fagaceae',
    });
  });

  it('falls back to the backbone when WCVP has no match of its own', () => {
    const prefill = proposalPrefill({
      ...PROPOSAL,
      lookup: { ...LOOKUP_EXACT, wcvp: null },
    });
    expect(prefill.nameSource).toBe('gbif');
    expect(prefill.canonicalName).toBe('Quercus robur');
  });

  it('RFC-81 R3 a fuzzy backbone match still supplies the spelling GBIF settled on', () => {
    const prefill = proposalPrefill({
      ...PROPOSAL,
      proposedName: 'Quercus robour',
      lookup: LOOKUP_FUZZY,
    });
    expect(prefill).toEqual({
      canonicalName: 'Quercus robur',
      nameSource: 'gbif',
      genusName: 'Quercus',
      familyName: 'Fagaceae',
    });
  });

  it('RFC-81 R3 a match above species rank never becomes the canonical name, but does supply the genus', () => {
    const prefill = proposalPrefill({
      ...PROPOSAL,
      proposedName: 'Quercus robur',
      lookup: LOOKUP_GENUS,
    });
    expect(prefill.canonicalName).toBe('Quercus robur');
    expect(prefill.nameSource).toBe('original');
    expect(prefill.genusName).toBe('Quercus');
  });

  it('falls back to the proposed name when nothing matched and when the lookup never ran', () => {
    for (const lookup of [LOOKUP_NONE, null]) {
      expect(proposalPrefill({ ...PROPOSAL, lookup })).toEqual({
        canonicalName: PROPOSAL.proposedName,
        nameSource: 'original',
        genusName: '',
        familyName: '',
      });
    }
    expect(proposalPrefill(PROPOSAL_LOOKUP_FAILED).canonicalName).toBe(
      PROPOSAL_LOOKUP_FAILED.proposedName,
    );
  });

  it('prefers WCVP over the backbone only when the verdict is exact', () => {
    const prefill = proposalPrefill({
      ...PROPOSAL,
      lookup: {
        verdict: 'fuzzy',
        backbone: { ...BACKBONE_MATCH, matchType: 'VARIANT', canonicalName: 'Quercus robur' },
        wcvp: { ...WCVP_MATCH, canonicalName: 'Quercus alba', genus: 'Quercus' },
      },
    });
    expect(prefill.canonicalName).toBe('Quercus robur');
    expect(prefill.nameSource).toBe('gbif');
  });
});
