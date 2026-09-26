import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TraitSummary } from '@treerepro/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  DICTIONARY,
  DICTIONARY_SEED_MASS,
  DICTIONARY_SEXUAL_SYSTEM,
  POLLINATION_MODE_SUMMARY,
  SEED_MASS_SUMMARY,
  SEXUAL_SYSTEM_SUMMARY,
} from '../../test/dataset-fixtures.ts';
import { tipText } from '../../test/render.tsx';
import { withRouter } from '../../test/router.tsx';
import { TraitCard } from './TraitCard.tsx';

// Three levels, the top one validated twice and contested.
const LEVELLED: TraitSummary = {
  ...SEXUAL_SYSTEM_SUMMARY,
  contested: true,
  levels: [
    {
      levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d20',
      key: 'dioecious',
      count: 4,
      validationCount: 2,
      contested: true,
    },
    {
      levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d21',
      key: 'monoecious',
      count: 1,
      validationCount: 0,
      contested: false,
    },
    {
      levelId: '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d22',
      key: 'hermaphrodite',
      count: 1,
      validationCount: 1,
      contested: false,
    },
  ],
};

describe('RFC-63 R10 TraitCard', () => {
  it('is a button named after the trait, with the record count, the pending line and the trait’s Contested badge', () => {
    render(<TraitCard summary={LEVELLED} onOpen={() => {}} />);
    const card = screen.getByRole('button', { name: /^sexual system/ });
    expect(card).toHaveTextContent('8 records');
    expect(card).toHaveTextContent('2 pending');
    expect(within(card).getByText('Contested')).toBeInTheDocument();
    expect(card.parentElement?.querySelector('[style]')).toBeNull();
  });

  it('spec §2 lists every level of the species, with no cap', () => {
    const many: TraitSummary = {
      ...LEVELLED,
      levels: Array.from({ length: 7 }, (_, i) => ({
        levelId: `018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8d${20 + i}`,
        key: `level_${i}`,
        count: 7 - i,
        validationCount: 0,
        contested: false,
      })),
    };
    render(<TraitCard summary={many} onOpen={() => {}} />);
    const list = screen.getByRole('list', { name: 'Levels of sexual system' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    expect(within(list).getByText('level_6')).toBeInTheDocument();
  });

  it('shows per level its record count, its validations, a bar and a Contested badge where it applies', () => {
    render(<TraitCard summary={LEVELLED} onOpen={() => {}} />);
    const list = screen.getByRole('list', { name: 'Levels of sexual system' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('dioecious');
    expect(items[0]).toHaveTextContent('4 records');
    expect(items[0]).toHaveTextContent('✓ 2');
    expect(within(items[0] as HTMLElement).getByText('Contested')).toBeInTheDocument();
    expect(items[1]).toHaveTextContent('1 record');
    expect(within(items[1] as HTMLElement).queryByText('Contested')).not.toBeInTheDocument();
    const fills = list.querySelectorAll('.bg-canopy-500');
    expect(fills[0]?.className).toContain('w-full');
    expect(fills[1]?.className).toContain('w-3/10');
  });

  it('spec §2 gives each level Validate, Contest and Complement, outside the card’s own button', async () => {
    const onValidateLevel = vi.fn();
    const onRespondLevel = vi.fn();
    const onOpen = vi.fn();
    render(
      <TraitCard
        summary={LEVELLED}
        onOpen={onOpen}
        onValidateLevel={onValidateLevel}
        onRespondLevel={onRespondLevel}
      />,
    );
    const card = screen.getByRole('button', { name: /^sexual system/ });
    const validate = screen.getByRole('button', { name: 'Validate dioecious for sexual system' });
    expect(card.contains(validate)).toBe(false);
    await userEvent.click(validate);
    expect(onValidateLevel).toHaveBeenCalledWith(LEVELLED.levels?.[0]);
    await userEvent.click(
      screen.getByRole('button', { name: 'Contest monoecious for sexual system' }),
    );
    expect(onRespondLevel).toHaveBeenLastCalledWith(LEVELLED.levels?.[1], 'contest');
    await userEvent.click(
      screen.getByRole('button', { name: 'Complement hermaphrodite for sexual system' }),
    );
    expect(onRespondLevel).toHaveBeenLastCalledWith(LEVELLED.levels?.[2], 'complement');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers only the actions the page passes', () => {
    render(<TraitCard summary={LEVELLED} onOpen={() => {}} onValidateLevel={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Validate dioecious for sexual system' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Contest / })).not.toBeInTheDocument();
  });

  it('shows min · mean · max with the unit for a quantitative trait, and no level list', () => {
    render(
      <TraitCard
        summary={{ ...SEED_MASS_SUMMARY, numeric: { min: 0.5, max: 3, mean: 1.25, count: 3 } }}
        onOpen={() => {}}
      />,
    );
    const card = screen.getByRole('button', { name: /seed mass/ });
    expect(card).toHaveTextContent('min · mean · max');
    expect(within(card).getByText('0.5 · 1.25 · 3 mg')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('spec R-5 shows a dash for the mean when no record has a single value or a mean', () => {
    render(
      <TraitCard
        summary={{ ...SEED_MASS_SUMMARY, numeric: { min: 2, max: 8, mean: null, count: 1 } }}
        onOpen={() => {}}
      />,
    );
    const card = screen.getByRole('button', { name: /seed mass/ });
    expect(within(card).getByText('2 · — · 8 mg')).toBeInTheDocument();
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

  it('renders an Add value button, named after the trait, beside the card when onAdd is given', async () => {
    const onAdd = vi.fn();
    const onOpen = vi.fn();
    render(<TraitCard summary={LEVELLED} onOpen={onOpen} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add value for sexual system' }));
    expect(onAdd).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('RFC-13 R11 shows a HelpTip with the trait description from the dictionary, outside the open button', async () => {
    const summary = { ...LEVELLED, trait: DICTIONARY_SEXUAL_SYSTEM };
    render(withRouter(<TraitCard summary={summary} dictionary={DICTIONARY} onOpen={() => {}} />));
    const card = await screen.findByRole('button', { name: /^sexual system/ });
    const tip = screen.getByRole('button', { name: 'What does sexual system mean?' });
    expect(card.contains(tip)).toBe(false);
    await userEvent.click(tip);
    expect(tipText(screen.getByRole('tooltip'))).toBe(
      'Distribution of male and female function among individuals.',
    );
  });

  it('spec §7.5 the tip of a quantitative trait names the unit its records are measured in', async () => {
    const summary = { ...SEED_MASS_SUMMARY, trait: DICTIONARY_SEED_MASS };
    render(withRouter(<TraitCard summary={summary} dictionary={DICTIONARY} onOpen={() => {}} />));
    await userEvent.click(await screen.findByRole('button', { name: 'What does seed mass mean?' }));
    expect(tipText(screen.getByRole('tooltip'))).toBe('Dry mass of one seed. Measured in mg.');
  });

  it('renders no HelpTip when the dictionary has no description for the trait', () => {
    render(<TraitCard summary={LEVELLED} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: /What does .* mean\?/ })).not.toBeInTheDocument();
  });
});
