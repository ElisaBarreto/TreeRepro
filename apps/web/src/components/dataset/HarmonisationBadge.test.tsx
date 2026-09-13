import { render, screen } from '@testing-library/react';
import { HARMONISATION_STATUSES } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { HarmonisationBadge } from './HarmonisationBadge.tsx';

describe('RFC-63 R5 HarmonisationBadge', () => {
  it('names every status in words and colours only the failure modes', () => {
    render(
      <div>
        {HARMONISATION_STATUSES.map((status) => (
          <HarmonisationBadge key={status} status={status} />
        ))}
      </div>,
    );
    expect(screen.getByText('harmonised').className).not.toContain('pollen');
    expect(screen.getByText('unknown level').className).toContain('pollen');
    expect(screen.getByText('multiple values').className).toContain('pollen');
    expect(screen.getByText('not a number').className).toContain('pollen');
    expect(screen.getByText('empty').className).not.toContain('pollen');
  });
});
