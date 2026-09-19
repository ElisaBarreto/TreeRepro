import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BACKBONE_MATCH,
  LOOKUP_EXACT,
  LOOKUP_FUZZY,
  LOOKUP_GENUS,
  LOOKUP_NONE,
  NO_MATCH,
  WCVP_MATCH,
} from '../../test/dataset-fixtures.ts';
import { LookupBadge, LookupCard } from './LookupCard.tsx';

describe('RFC-81 R2 LookupCard', () => {
  it('shows the fields of a match and links to its GBIF page with rel="noopener noreferrer"', () => {
    render(<LookupCard source="GBIF backbone" match={BACKBONE_MATCH} />);
    const card = screen.getByRole('region', { name: 'GBIF backbone' });
    expect(within(card).getByText('Quercus robur L.')).toBeInTheDocument();
    expect(card).toHaveTextContent('SPECIES');
    expect(card).toHaveTextContent('ACCEPTED');
    expect(card).toHaveTextContent('Fagaceae');
    expect(card).toHaveTextContent('Quercus');
    expect(card).toHaveTextContent('99');
    const link = within(card).getByRole('link', { name: /gbif/i });
    expect(link).toHaveAttribute('href', 'https://www.gbif.org/species/2878688');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('RFC-81 R2 WCVP reports no confidence, and that reads as no number rather than zero', () => {
    render(<LookupCard source="WCVP" match={WCVP_MATCH} />);
    const card = screen.getByRole('region', { name: 'WCVP' });
    expect(within(card).getByText('Confidence').nextSibling).toHaveTextContent('—');
    expect(card).not.toHaveTextContent('0');
  });

  it('RFC-81 R3 a call that did not complete and an answer of "no such name" read differently', () => {
    const { rerender } = render(<LookupCard source="WCVP" match={null} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByText('WCVP did not answer: the call to it failed.')).toBeInTheDocument();

    // `matchType: 'NONE'` is an answer — the source was reached and has no
    // row for the name — and it must not draw a card of dashes, which would
    // read as a match with nothing in it.
    rerender(<LookupCard source="WCVP" match={NO_MATCH} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByText('WCVP answered and has no record of this name.')).toBeInTheDocument();
  });

  it('shows the note when a match carries one', () => {
    render(<LookupCard source="GBIF backbone" match={LOOKUP_GENUS.backbone} />);
    expect(screen.getByText('matched the genus')).toBeInTheDocument();
  });
});

describe('RFC-81 R3 LookupBadge', () => {
  it('reads each verdict as its own fact', () => {
    const { rerender } = render(<LookupBadge lookup={LOOKUP_EXACT} />);
    expect(screen.getByText('exact match')).toBeInTheDocument();

    rerender(<LookupBadge lookup={LOOKUP_FUZZY} />);
    expect(screen.getByText('fuzzy')).toBeInTheDocument();

    rerender(<LookupBadge lookup={LOOKUP_NONE} />);
    expect(screen.getByText('not found')).toBeInTheDocument();
  });

  it('a lookup that never completed reads "lookup failed", never "not found"', () => {
    render(<LookupBadge lookup={null} />);
    expect(screen.getByText('lookup failed')).toBeInTheDocument();
    expect(screen.queryByText('not found')).not.toBeInTheDocument();
  });

  it('an EXACT match at genus rank is not an exact match: the badge renders the API’s verdict', () => {
    render(<LookupBadge lookup={LOOKUP_GENUS} />);
    expect(screen.getByText('not found')).toBeInTheDocument();
    expect(screen.queryByText('exact match')).not.toBeInTheDocument();
  });
});
