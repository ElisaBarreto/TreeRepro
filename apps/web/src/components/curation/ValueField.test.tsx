import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SEED_MASS_TRAIT, SEXUAL_SYSTEM_TRAIT } from '../../test/dataset-fixtures.ts';
import { ValueField } from './ValueField.tsx';

const IDS = { level: 'level-field', numeric: 'numeric-field' };

function mount(props: Partial<Parameters<typeof ValueField>[0]> = {}) {
  const onLevel = vi.fn();
  const onNumeric = vi.fn();
  render(
    <ValueField
      trait={SEXUAL_SYSTEM_TRAIT}
      levelId=""
      numeric=""
      onLevel={onLevel}
      onNumeric={onNumeric}
      errors={{}}
      ids={IDS}
      {...props}
    />,
  );
  return { onLevel, onNumeric };
}

describe('RFC-65 R1 ValueField', () => {
  it('offers the active levels only and reports the chosen one', async () => {
    const { onLevel } = mount();
    const level = screen.getByRole('combobox', { name: /level/i });
    expect(screen.queryByRole('option', { name: 'polygamous' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'dioecious' })).toBeInTheDocument();
    await userEvent.selectOptions(level, 'dioecious');
    expect(onLevel).toHaveBeenCalledWith('018f6a5e-7c3d-7a2b-9c1e-4f5a6b7c8e12');
  });

  it('takes a number in the trait unit for a quantitative trait', async () => {
    const { onNumeric } = mount({ trait: SEED_MASS_TRAIT });
    const number = screen.getByRole('spinbutton', { name: /number/i });
    expect(screen.getByText('mg')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await userEvent.type(number, '3');
    expect(onNumeric).toHaveBeenCalledWith('3');
  });

  it('shows the error the API named under the control', () => {
    mount({ trait: SEED_MASS_TRAIT, errors: { 'value.numeric': 'Enter a number.' } });
    expect(screen.getByText('Enter a number.')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /number/i })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});
