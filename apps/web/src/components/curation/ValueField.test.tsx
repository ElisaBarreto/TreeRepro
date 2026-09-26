import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SEED_MASS_TRAIT, SEXUAL_SYSTEM_TRAIT } from '../../test/dataset-fixtures.ts';
import {
  EMPTY_QUANTITATIVE,
  type QuantitativeText,
  quantitativeToBody,
  ValueField,
} from './ValueField.tsx';

const HERMAPHRODITE = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e11';
const DIOECIOUS = '018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12';

function mount(
  props: Partial<{
    levelIds: string[];
    quantitative: QuantitativeText;
    errors: Record<string, string>;
    quantitativeTrait: boolean;
  }> = {},
) {
  const onLevels = vi.fn();
  const onQuantitative = vi.fn();
  render(
    <ValueField
      trait={props.quantitativeTrait ? SEED_MASS_TRAIT : SEXUAL_SYSTEM_TRAIT}
      levelIds={props.levelIds ?? []}
      quantitative={props.quantitative ?? EMPTY_QUANTITATIVE}
      onLevels={onLevels}
      onQuantitative={onQuantitative}
      errors={props.errors ?? {}}
      idPrefix="v"
    />,
  );
  return { onLevels, onQuantitative };
}

describe('RFC-65 R1 ValueField categorical', () => {
  it('offers the active levels as checkboxes, several at once (R-3)', async () => {
    const { onLevels } = mount({ levelIds: [HERMAPHRODITE] });
    expect(screen.getByRole('group', { name: 'Levels' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'hermaphrodite' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'dioecious' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'polygamous' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'dioecious' }));
    expect(onLevels).toHaveBeenLastCalledWith([HERMAPHRODITE, DIOECIOUS]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'hermaphrodite' }));
    expect(onLevels).toHaveBeenLastCalledWith([]);
  });

  it('shows the error for the levels under the group', () => {
    mount({ errors: { 'value.levelIds': 'Choose at least one level.' } });
    expect(screen.getByRole('group', { name: 'Levels' })).toHaveAccessibleDescription(
      'Choose at least one level.',
    );
  });
});

describe('RFC-65 R1 ValueField quantitative', () => {
  it('takes six numbers, each labelled in the trait unit except n, with the hint once', async () => {
    const { onQuantitative } = mount({ quantitativeTrait: true });
    for (const name of ['Single value (mg)', 'Min (mg)', 'Max (mg)', 'Mean (mg)', 'SD (mg)', 'n']) {
      expect(screen.getByRole('spinbutton', { name })).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        'Give a single value, or summary statistics — at least one of single, min, max or mean. Min must not exceed max; SD is 0 or more; n is a whole number, 1 or more.',
      ),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Min (mg)' }), '2');
    expect(onQuantitative).toHaveBeenLastCalledWith({ ...EMPTY_QUANTITATIVE, min: '2' });
  });

  it('shows a field error under its input and a value error under the group', () => {
    mount({
      quantitativeTrait: true,
      errors: {
        'value.quantitative.min': 'Min must not exceed max',
        'value.quantitative': 'Enter at least one of single, min, max or mean.',
      },
    });
    expect(screen.getByRole('spinbutton', { name: 'Min (mg)' })).toHaveAccessibleDescription(
      'Min must not exceed max',
    );
    expect(screen.getByText('Enter at least one of single, min, max or mean.')).toBeInTheDocument();
  });
});

describe('RFC-65 R1 quantitativeToBody', () => {
  it('turns the filled inputs into numbers and leaves the blank ones out', () => {
    expect(
      quantitativeToBody({ single: '', min: ' 0.5 ', max: '3', mean: '', sd: '0', n: '12' }),
    ).toEqual({ min: 0.5, max: 3, sd: 0, n: 12 });
  });
});
