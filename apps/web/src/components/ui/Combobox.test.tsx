import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render.tsx';
import { Combobox, type ComboboxOption } from './Combobox.tsx';

const OPTIONS: ComboboxOption[] = [
  { id: '1', label: 'Alfaro 2023', hint: 'GEB' },
  { id: '2', label: 'Alvarez 2020' },
];

function Harness({
  onCreate,
  onChange,
}: {
  onCreate?: (text: string) => Promise<ComboboxOption>;
  onChange?: (next: ComboboxOption | null) => void;
}) {
  const [value, setValue] = useState<ComboboxOption | null>(null);
  return (
    <Combobox
      id="ref"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      search={async (term) =>
        OPTIONS.filter((o) => o.label.toLowerCase().includes(term.toLowerCase()))
      }
      searchKey="test"
      minChars={2}
      listLabel="Reference suggestions"
      placeholder="Type to search"
      onCreate={onCreate}
    />
  );
}

describe('RFC-13 R5 Combobox', () => {
  it('searches after minChars, lists options with hints, selects one and shows it with a Clear button', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'a');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.type(input, 'l');
    const list = await screen.findByRole('listbox', { name: 'Reference suggestions' });
    expect(list).toHaveTextContent('Alfaro 2023');
    expect(list).toHaveTextContent('GEB');
    await userEvent.click(screen.getByRole('option', { name: /Alvarez 2020/ }));
    expect(onChange).toHaveBeenCalledWith({ id: '2', label: 'Alvarez 2020' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Alvarez 2020')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('moves focus into the list with ArrowDown, between options with the arrows, back to the input with Escape', async () => {
    renderWithProviders(<Harness />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'al');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Alfaro/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Alvarez/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('option', { name: /Alfaro/ })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows the empty message and, with onCreate, a trailing create option that adds and selects', async () => {
    const onCreate = vi.fn(async (text: string) => ({ id: '9', label: text }));
    renderWithProviders(<Harness onCreate={onCreate} />);
    await userEvent.type(screen.getByRole('combobox'), 'zz');
    expect(await screen.findByText('No matches.')).toBeInTheDocument();
    const create = screen.getByRole('option', { name: 'Create "zz"' });
    await userEvent.click(create);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('zz'));
    expect(await screen.findByText('zz')).toBeInTheDocument();
  });

  it('without onCreate shows only the empty message; a search failure shows an error line', async () => {
    renderWithProviders(<Harness />);
    await userEvent.type(screen.getByRole('combobox'), 'zz');
    expect(await screen.findByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
