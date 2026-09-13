import { render, screen } from '@testing-library/react';
import { REVIEW_STATUSES } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { ReviewBadge } from './ReviewBadge.tsx';

describe('RFC-63 R6 ReviewBadge', () => {
  it('shows the four states: confirmed green, disputed red, withdrawn struck through', () => {
    render(
      <div>
        {REVIEW_STATUSES.map((status) => (
          <ReviewBadge key={status} status={status} />
        ))}
      </div>,
    );
    expect(screen.getByText('unreviewed').className).toContain('mist');
    expect(screen.getByText('confirmed').className).toContain('canopy-200');
    expect(screen.getByText('disputed').className).toContain('red');
    const withdrawn = screen.getByText('withdrawn');
    expect(withdrawn.className).toContain('line-through');
    expect(withdrawn.parentElement?.className).toContain('mist');
  });
});
