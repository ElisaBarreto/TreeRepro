import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MapEntry } from '@treerepro/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DICTIONARY,
  DICTIONARY_SELF_COMPATIBILITY,
  SEED_LENGTH_MISSING_SUMMARY,
  SELF_COMPATIBILITY_MISSING_SUMMARY,
} from '../../test/dataset-fixtures.ts';
import { tipText } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { EmptyTraitCard } from './EmptyTraitCard.tsx';

// `EmptyTraitCard` calls `useMaps()` itself (RFC-76 R8); mocked directly, the
// same way `MapsPage.test.tsx` does, rather than through a
// `QueryClientProvider` this file otherwise has no need for.
const maps = vi.hoisted(() => ({ useMaps: vi.fn() }));
vi.mock('../../api/maps.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/maps.ts')>()),
  ...maps,
}));

function mapsResult(data: MapEntry[]) {
  return { data, isPending: false, isSuccess: true, isError: false, error: null };
}

beforeEach(() => {
  maps.useMaps.mockReset();
  maps.useMaps.mockReturnValue(mapsResult([]));
});

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

  describe('RFC-76 R8 maps link in the HelpTip', () => {
    it('adds a Maps link beside Learn more when the trait has a description and maps', async () => {
      maps.useMaps.mockReturnValue(
        mapsResult([
          {
            traitId: DICTIONARY_SELF_COMPATIBILITY.id,
            kind: 'completeness',
            levelId: null,
            file: 'x.svg',
            dataVersion: '2026-09-01',
          },
        ]),
      );
      render(
        withRouter(
          <EmptyTraitCard summary={SELF_COMPATIBILITY_MISSING_SUMMARY} dictionary={DICTIONARY} />,
        ),
      );
      await userEvent.click(
        await screen.findByRole('button', { name: 'What does self compatibility mean?' }),
      );
      const tip = screen.getByRole('tooltip');
      expect(within(tip).getByRole('link', { name: 'Learn more' })).toBeInTheDocument();
      expect(within(tip).getByRole('link', { name: 'Maps' })).toHaveAttribute(
        'href',
        `/app/maps/${DICTIONARY_SELF_COMPATIBILITY.id}`,
      );
    });

    it('still shows the popover, holding the Maps link, for a trait with maps but no description', async () => {
      maps.useMaps.mockReturnValue(
        mapsResult([
          {
            traitId: SELF_COMPATIBILITY_MISSING_SUMMARY.trait.id,
            kind: 'completeness',
            levelId: null,
            file: 'x.svg',
            dataVersion: '2026-09-01',
          },
        ]),
      );
      render(withRouter(<EmptyTraitCard summary={SELF_COMPATIBILITY_MISSING_SUMMARY} />));
      await userEvent.click(
        await screen.findByRole('button', { name: 'What does self compatibility mean?' }),
      );
      const tip = screen.getByRole('tooltip');
      expect(within(tip).getByRole('link', { name: 'Maps' })).toHaveAttribute(
        'href',
        `/app/maps/${SELF_COMPATIBILITY_MISSING_SUMMARY.trait.id}`,
      );
    });

    it('renders no HelpTip at all for a trait with neither a description nor maps', () => {
      maps.useMaps.mockReturnValue(mapsResult([]));
      render(<EmptyTraitCard summary={SELF_COMPATIBILITY_MISSING_SUMMARY} />);
      expect(screen.queryByRole('button', { name: /What does .* mean\?/ })).not.toBeInTheDocument();
    });
  });
});
