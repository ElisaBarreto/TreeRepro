import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DICTIONARY,
  SEED_LENGTH_MISSING_SUMMARY,
  SELF_COMPATIBILITY_MISSING_SUMMARY,
} from '../../test/dataset-fixtures.ts';
import { tipText } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { EmptyTraitCard } from './EmptyTraitCard.tsx';

describe('RFC-70 R7 EmptyTraitCard', () => {
  it('names the trait, says "No records yet" and shows the HelpTip description', async () => {
    // Through a router: the tip carries a "Learn more" link (RFC-73 R4).
    render(
      withRouter(
        <EmptyTraitCard summary={SELF_COMPATIBILITY_MISSING_SUMMARY} dictionary={DICTIONARY} />,
      ),
    );
    expect(await screen.findByText('self compatibility')).toBeInTheDocument();
    expect(screen.getByText('No records yet')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'What does self compatibility mean?' }),
    );
    expect(tipText(screen.getByRole('tooltip'))).toBe(
      'Whether an individual sets seed with its own pollen.',
    );
  });

  it('names the unit for a quantitative missing trait, whose levels are null rather than []', () => {
    render(<EmptyTraitCard summary={SEED_LENGTH_MISSING_SUMMARY} dictionary={DICTIONARY} />);
    expect(screen.getByText('seed length (mm)')).toBeInTheDocument();
    expect(SEED_LENGTH_MISSING_SUMMARY.levels).toBeNull();
  });

  it('spec §7.5 the tip of a quantitative trait names the unit its records are measured in', async () => {
    render(
      withRouter(<EmptyTraitCard summary={SEED_LENGTH_MISSING_SUMMARY} dictionary={DICTIONARY} />),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'What does seed length mean?' }),
    );
    expect(tipText(screen.getByRole('tooltip'))).toBe('Length of the mature seed. Measured in mm.');
  });

  it('a categorical missing trait answers levels: [], not null, and renders all the same', () => {
    render(<EmptyTraitCard summary={SELF_COMPATIBILITY_MISSING_SUMMARY} />);
    expect(SELF_COMPATIBILITY_MISSING_SUMMARY.levels).toEqual([]);
    expect(screen.getByText('No records yet')).toBeInTheDocument();
  });

  it('renders no HelpTip when the dictionary has no description for the trait', () => {
    render(<EmptyTraitCard summary={SELF_COMPATIBILITY_MISSING_SUMMARY} />);
    expect(screen.queryByRole('button', { name: /What does .* mean\?/ })).not.toBeInTheDocument();
  });

  it('renders "Add the first entry" only when onAdd is given, and calls it', async () => {
    const { rerender } = render(<EmptyTraitCard summary={SELF_COMPATIBILITY_MISSING_SUMMARY} />);
    expect(screen.queryByRole('button', { name: 'Add the first entry' })).not.toBeInTheDocument();

    const onAdd = vi.fn();
    rerender(<EmptyTraitCard summary={SELF_COMPATIBILITY_MISSING_SUMMARY} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add the first entry' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
