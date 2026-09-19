import { describe, expect, it } from 'vitest';
import {
  BACKBONE_MATCH,
  LOOKUP_EXACT_WCVP_MISS,
  LOOKUP_FUZZY,
  LOOKUP_GENUS,
  LOOKUP_NONE,
  LOOKUP_WCVP_FAILED,
  LOOKUP_WCVP_GENUS_ONLY,
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

  it('falls back to the backbone when the WCVP call failed', () => {
    const prefill = proposalPrefill({ ...PROPOSAL, lookup: LOOKUP_WCVP_FAILED });
    expect(prefill).toEqual({
      canonicalName: 'Quercus robur',
      nameSource: 'gbif',
      genusName: 'Quercus',
      familyName: 'Fagaceae',
    });
  });

  it('RFC-81 R3 a WCVP miss is an answer, not a match: the backbone still fills the form', () => {
    // The commonest real outcome — backbone EXACT at species rank, WCVP
    // answering `results: []`, which the API maps to a `matchType: 'NONE'`
    // match rather than to `null`. Taking that match because it is non-null
    // opened the approval with no genus, no family and provenance recorded
    // as `original`, under a badge reading "exact match".
    expect(proposalPrefill({ ...PROPOSAL, lookup: LOOKUP_EXACT_WCVP_MISS })).toEqual({
      canonicalName: 'Quercus robur',
      nameSource: 'gbif',
      genusName: 'Quercus',
      familyName: 'Fagaceae',
    });
  });

  it('RFC-81 R3 a WCVP match above species rank does not beat a species-rank backbone', () => {
    expect(proposalPrefill({ ...PROPOSAL, lookup: LOOKUP_WCVP_GENUS_ONLY })).toEqual({
      canonicalName: 'Quercus robur',
      nameSource: 'gbif',
      genusName: 'Quercus',
      familyName: 'Fagaceae',
    });
  });

  it('RFC-81 R2 a rank below species is still the taxon proposed, so its name is taken', () => {
    for (const rank of ['SUBSPECIES', 'VARIETY', 'SUBVARIETY', 'FORM', 'SUBFORM']) {
      const prefill = proposalPrefill({
        ...PROPOSAL,
        proposedName: 'Quercus robur fastigiata',
        lookup: {
          backbone: {
            ...BACKBONE_MATCH,
            rank,
            canonicalName: 'Quercus robur var. fastigiata',
            note: `matched the ${rank.toLowerCase()}`,
          },
          wcvp: null,
          // `verdictOf` needs `rank === 'SPECIES'` for `exact`, so a match
          // below species rank leaves the verdict `none` — which the prefill
          // does not read, and which must not be misstated here.
          verdict: 'none',
        },
      });
      expect(prefill.canonicalName, rank).toBe('Quercus robur var. fastigiata');
      expect(prefill.nameSource, rank).toBe('gbif');
    }
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

  it('prefers WCVP over the backbone when the WCVP match is itself exact', () => {
    // Not "when the verdict is exact": the verdict is `exact` as soon as
    // *either* source matched exactly, so it says nothing about which one
    // did. A backbone that only approximated the name loses to a WCVP row
    // that matched it.
    const prefill = proposalPrefill({
      ...PROPOSAL,
      lookup: {
        verdict: 'exact',
        backbone: { ...BACKBONE_MATCH, matchType: 'VARIANT', canonicalName: 'Quercus robur' },
        wcvp: { ...WCVP_MATCH, canonicalName: 'Quercus alba', genus: 'Quercus' },
      },
    });
    expect(prefill.canonicalName).toBe('Quercus alba');
    expect(prefill.nameSource).toBe('wcvp');
  });
});
