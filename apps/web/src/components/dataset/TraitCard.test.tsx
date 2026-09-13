import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  POLLINATION_MODE_SUMMARY,
  SEED_MASS_SUMMARY,
  SEXUAL_SYSTEM_SUMMARY,
} from '../../test/dataset-fixtures.ts';
import { TraitCard } from './TraitCard.tsx';

describe('RFC-63 R10 TraitCard', () => {
  it('is a button named after the trait, with the record count, level bars, pending and accepted lines', () => {
    render(<TraitCard summary={SEXUAL_SYSTEM_SUMMARY} onOpen={() => {}} />);
    const card = screen.getByRole('button', { name: /sexual system/ });
    expect(card).toHaveTextContent('8 records');
    // Each bar's label sits next to its count; the accepted line repeats
    // "dioecious" lower down, hence the selector.
    const rows = within(card)
      .getAllByText(/^(dioecious|monoecious|hermaphrodite)$/, { selector: '.truncate' })
      .map((label) => label.parentElement?.textContent);
    expect(rows).toEqual(['dioecious4', 'monoecious1', 'hermaphrodite1']);
    // The widest bar is the top level; the others scale against it in tenths.
    const fills = card.querySelectorAll('.bg-canopy-500');
    expect(fills).toHaveLength(3);
    expect(fills[0]?.className).toContain('w-full');
    expect(fills[1]?.className).toContain('w-3/10');
    expect(fills[2]?.className).toContain('w-3/10');
    expect(card).toHaveTextContent('2 pending');
    expect(card).toHaveTextContent('accepted: dioecious');
    expect(card).not.toHaveAttribute('style');
    expect(card.querySelector('[style]')).toBeNull();
  });

  it('shows at most five levels', () => {
    const many = {
      ...SEXUAL_SYSTEM_SUMMARY,
      levels: Array.from({ length: 7 }, (_, i) => ({
        levelId: `018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d${20 + i}`,
        key: `level_${i}`,
        count: 7 - i,
      })),
    };
    render(<TraitCard summary={many} onOpen={() => {}} />);
    expect(screen.getAllByText(/^level_\d$/)).toHaveLength(5);
    expect(screen.queryByText('level_5')).not.toBeInTheDocument();
  });

  it('shows min · median · max with the unit for a quantitative trait, without pending or accepted lines', () => {
    render(<TraitCard summary={SEED_MASS_SUMMARY} onOpen={() => {}} />);
    const card = screen.getByRole('button', { name: /seed mass/ });
    expect(card).toHaveTextContent('mg');
    expect(card).toHaveTextContent('3 records');
    expect(within(card).getByText('0.5 · 1.25 · 3 mg')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('pending');
    expect(card).not.toHaveTextContent('accepted');
  });

  it('says "1 record" for a single record and calls onOpen when clicked', async () => {
    const onOpen = vi.fn();
    render(<TraitCard summary={POLLINATION_MODE_SUMMARY} onOpen={onOpen} />);
    const card = screen.getByRole('button', { name: /pollination mode/ });
    expect(card).toHaveTextContent('1 record');
    expect(card).not.toHaveTextContent('1 records');
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders an Add value button beside the card when onAdd is given', async () => {
    const onAdd = vi.fn();
    const onOpen = vi.fn();
    render(<TraitCard summary={SEXUAL_SYSTEM_SUMMARY} onOpen={onOpen} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add value' }));
    expect(onAdd).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
