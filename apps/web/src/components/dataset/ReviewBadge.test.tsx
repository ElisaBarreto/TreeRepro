import { render, screen } from '@testing-library/react';
import { REVIEW_STATUSES } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { ReviewBadge } from './ReviewBadge.tsx';

describe('RFC-63 R6 ReviewBadge', () => {
  it('shows the three states: contested red, validated green, unvalidated neutral', () => {
    render(
      <div>
        {REVIEW_STATUSES.map((status) => (
          <ReviewBadge key={status} status={status} />
        ))}
      </div>,
    );
    expect(screen.getByText('Contested').className).toContain('red');
    expect(screen.getByText('Validated').className).toContain('canopy-200');
    expect(screen.getByText('Unvalidated').className).toContain('mist');
  });
});
