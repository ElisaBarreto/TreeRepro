import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render.tsx';
import { Combobox, type ComboboxOption } from './Combobox.tsx';
import { Field } from './Field.tsx';

const OPTIONS: ComboboxOption[] = [
  { id: '1', label: 'Alfaro 2023', hint: 'GEB' },
  { id: '2', label: 'Alvarez 2020', description: 'mm' },
];

const filterOptions = async (term: string) =>
  OPTIONS.filter((o) => o.label.toLowerCase().includes(term.toLowerCase()));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// `Field` clones its direct child, so the hint case renders the Combobox
// straight inside it, the way the dialogs do.
function Harness({
  onCreate,
  createErrorMessage,
  onChange,
  search = filterOptions,
  hint,
}: {
  onCreate?: (text: string) => Promise<ComboboxOption>;
  createErrorMessage?: (error: unknown) => string;
  onChange?: (next: ComboboxOption | null) => void;
  search?: (term: string) => Promise<ComboboxOption[]>;
  hint?: string;
}) {
  const [value, setValue] = useState<ComboboxOption | null>(null);
  const combobox = (
    <Combobox
      id="ref"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      search={search}
      searchKey="test"
      minChars={2}
      listLabel="Reference suggestions"
      placeholder="Type to search"
      onCreate={onCreate}
      createErrorMessage={createErrorMessage}
    />
  );
  return hint ? (
    <Field id="ref" label="Reference" hint={hint}>
      {combobox}
    </Field>
  ) : (
    combobox
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
    expect(onChange).toHaveBeenCalledWith(OPTIONS[1]);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Alvarez 2020')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('does not reopen the list with stale results after Clear', async () => {
    renderWithProviders(<Harness />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'al');
    await screen.findByRole('listbox');
    await userEvent.click(screen.getByRole('option', { name: /Alfaro/ }));
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));

    const reopened = screen.getByRole('combobox');
    expect(reopened).toHaveValue('');
    expect(reopened).not.toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Give the 300 ms debounce a chance to catch up; the list must stay closed.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.queryByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
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

  it('without onCreate shows only the empty message, with no listbox and no aria-expanded', async () => {
    renderWithProviders(<Harness />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'zz');
    expect(await screen.findByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-expanded', 'true');
    expect(input).not.toHaveAttribute('aria-controls');
  });

  it('shows an error line when the search rejects', async () => {
    renderWithProviders(<Harness search={async () => Promise.reject(new Error('down'))} />);
    await userEvent.type(screen.getByRole('combobox'), 'al');
    expect(await screen.findByText('Could not load suggestions.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('hides the create option when the term matches an option exactly', async () => {
    const onCreate = vi.fn(async (text: string) => ({ id: '9', label: text }));
    renderWithProviders(<Harness onCreate={onCreate} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'Alvarez 202');
    const list = await screen.findByRole('listbox');
    expect(screen.getByRole('option', { name: 'Create "Alvarez 202"' })).toBeInTheDocument();
    await userEvent.type(input, '0');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /^Create/ })).not.toBeInTheDocument(),
    );
    expect(list).toHaveTextContent('Alvarez 2020');
  });

  it("offers to create the term only once its own results are in, not on the previous term's", async () => {
    const pending = deferred<ComboboxOption[]>();
    const search = vi.fn((term: string) =>
      term === 'alz' ? pending.promise : filterOptions(term),
    );
    const onCreate = vi.fn(async (text: string) => ({ id: '9', label: text }));
    renderWithProviders(<Harness onCreate={onCreate} search={search} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'al');
    const list = await screen.findByRole('listbox');
    expect(list).toHaveTextContent('Alfaro 2023');
    await userEvent.type(input, 'z');
    await waitFor(() => expect(search).toHaveBeenCalledWith('alz'));
    // The previous results stay on screen while "alz" loads, but no create
    // option is derived from them.
    expect(screen.getByRole('listbox')).toHaveTextContent('Alfaro 2023');
    expect(screen.queryByRole('option', { name: /^Create/ })).not.toBeInTheDocument();
    pending.resolve([]);
    expect(await screen.findByRole('option', { name: 'Create "alz"' })).toBeInTheDocument();
  });

  it('shows a description on the suggestion row only, never next to the chosen value', async () => {
    renderWithProviders(<Harness />);
    await userEvent.type(screen.getByRole('combobox'), 'alv');
    const option = await screen.findByRole('option', { name: /Alvarez 2020/ });
    expect(option).toHaveTextContent('mm');
    await userEvent.click(option);
    expect(screen.getByText('Alvarez 2020')).toBeInTheDocument();
    expect(screen.queryByText('mm')).not.toBeInTheDocument();
  });

  it('shows the sentence createErrorMessage derives from a failed create, and the generic one without it', async () => {
    const taken = new Error('taken');
    const onCreate = vi.fn(async () => Promise.reject(taken));
    const createErrorMessage = vi.fn((error: unknown) =>
      error === taken ? 'A genus with this name already exists.' : 'Other',
    );
    renderWithProviders(<Harness onCreate={onCreate} createErrorMessage={createErrorMessage} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'alv');
    await userEvent.click(await screen.findByRole('option', { name: 'Create "alv"' }));
    expect(await screen.findByText('A genus with this name already exists.')).toBeInTheDocument();
    expect(createErrorMessage).toHaveBeenCalledWith(taken);
    expect(input).toHaveAccessibleDescription('A genus with this name already exists.');
  });

  it('clears a failed create once an option is chosen', async () => {
    const onCreate = vi.fn(async () => Promise.reject(new Error('down')));
    renderWithProviders(<Harness onCreate={onCreate} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'alv');
    await userEvent.click(await screen.findByRole('option', { name: 'Create "alv"' }));
    expect(await screen.findByText('Could not create it. Try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Alvarez/ }));
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByText('Could not create it. Try again.')).not.toBeInTheDocument();
  });
});

describe('RFC-13 R5 Combobox inside a Field and a form', () => {
  it('carries the aria-describedby the Field attaches, on the input and on the Clear button', async () => {
    renderWithProviders(<Harness hint="Type a citation key." />);
    const input = screen.getByRole('combobox', { name: 'Reference' });
    expect(input).toHaveAttribute('aria-describedby', 'ref-hint');
    expect(input).toHaveAccessibleDescription('Type a citation key.');
    await userEvent.type(input, 'al');
    await userEvent.click(await screen.findByRole('option', { name: /Alfaro/ }));
    expect(screen.getByRole('button', { name: /clear/i })).toHaveAttribute(
      'aria-describedby',
      'ref-hint',
    );
  });

  it('lets Escape through while no list is open, and swallows it while one is', async () => {
    renderWithProviders(<Harness />);
    const input = screen.getByRole('combobox');
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true);
    await userEvent.type(input, 'al');
    await screen.findByRole('listbox');
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('does not submit the enclosing form on Enter while the list is open', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <Harness />
        <button type="submit">Save</button>
      </form>,
    );
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'al');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
