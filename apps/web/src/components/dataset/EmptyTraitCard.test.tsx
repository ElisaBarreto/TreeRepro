import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DICTIONARY,
  SEED_MASS_MISSING_SUMMARY,
  SEXUAL_SYSTEM_MISSING_SUMMARY,
} from '../../test/dataset-fixtures.ts';
import { EmptyTraitCard } from './EmptyTraitCard.tsx';

describe('RFC-70 R7 EmptyTraitCard', () => {
  it('names the trait, says "No records yet" and shows the HelpTip description', async () => {
    render(<EmptyTraitCard summary={SEXUAL_SYSTEM_MISSING_SUMMARY} dictionary={DICTIONARY} />);
    expect(screen.getByText('sexual system')).toBeInTheDocument();
    expect(screen.getByText('No records yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'What does sexual system mean?' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Distribution of male and female function among individuals.',
    );
  });

  it('names the unit for a quantitative missing trait, whose levels are null rather than []', () => {
    render(<EmptyTraitCard summary={SEED_MASS_MISSING_SUMMARY} dictionary={DICTIONARY} />);
    expect(screen.getByText('seed mass (mg)')).toBeInTheDocument();
    expect(SEED_MASS_MISSING_SUMMARY.levels).toBeNull();
  });

  it('a categorical missing trait answers levels: [], not null, and renders all the same', () => {
    render(<EmptyTraitCard summary={SEXUAL_SYSTEM_MISSING_SUMMARY} />);
    expect(SEXUAL_SYSTEM_MISSING_SUMMARY.levels).toEqual([]);
    expect(screen.getByText('No records yet')).toBeInTheDocument();
  });

  it('renders no HelpTip when the dictionary has no description for the trait', () => {
    render(<EmptyTraitCard summary={SEXUAL_SYSTEM_MISSING_SUMMARY} />);
    expect(screen.queryByRole('button', { name: /What does .* mean\?/ })).not.toBeInTheDocument();
  });

  it('renders "Add the first entry" only when onAdd is given, and calls it', async () => {
    const { rerender } = render(<EmptyTraitCard summary={SEXUAL_SYSTEM_MISSING_SUMMARY} />);
    expect(screen.queryByRole('button', { name: 'Add the first entry' })).not.toBeInTheDocument();

    const onAdd = vi.fn();
    rerender(<EmptyTraitCard summary={SEXUAL_SYSTEM_MISSING_SUMMARY} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add the first entry' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
