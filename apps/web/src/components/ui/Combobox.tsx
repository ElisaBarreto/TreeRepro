import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { Badge } from './Badge.tsx';
import { Button } from './Button.tsx';
import { Input } from './Input.tsx';

export interface ComboboxOption {
  id: string;
  label: string;
  /** Secondary text shown after the label (a family, a year). */
  hint?: string;
}

export interface ComboboxProps {
  id: string;
  value: ComboboxOption | null;
  onChange: (next: ComboboxOption | null) => void;
  search: (term: string) => Promise<ComboboxOption[]>;
  /** Namespace of the suggestion queries (`['combobox', searchKey, term]`). */
  searchKey: string;
  minChars?: number;
  placeholder?: string;
  listLabel: string;
  emptyMessage?: string;
  /** Adds a trailing `Create "<text>"` option; the created option is selected. */
  onCreate?: (text: string) => Promise<ComboboxOption>;
  disabled?: boolean;
  invalid?: boolean;
}

/**
 * Text input with an asynchronous suggestion list. The list is a
 * `<div role="listbox">` of `<button role="option">` (docs/gotchas/web.md):
 * ArrowDown moves focus from the input to the first option, the arrows move
 * between options, Enter or a click selects, Escape closes the list and
 * returns to the input. A chosen value replaces the input with a badge and
 * a Clear button, as the genus filter of the species search does. When the
 * caller passes `onCreate` and the term matches no option exactly, a last
 * option offers to create it. The search runs on the debounced term once it
 * reaches `minChars`.
 * @rfc RFC-13 R5, R6
 */
export function Combobox({
  id,
  value,
  onChange,
  search,
  searchKey,
  minChars = 1,
  placeholder,
  listLabel,
  emptyMessage = 'No matches.',
  onCreate,
  disabled,
  invalid,
}: ComboboxProps) {
  const [text, setText] = useState('');
  const [closed, setClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const term = useDebouncedValue(text.trim(), 300);
  const active = term.length >= minChars && !closed;
  const suggestions = useQuery({
    queryKey: ['combobox', searchKey, term],
    queryFn: () => search(term),
    enabled: active,
    placeholderData: keepPreviousData,
  });
  const options = active ? suggestions.data : undefined;
  const exact = options?.some((o) => o.label.toLowerCase() === term.toLowerCase()) ?? false;
  const showCreate = onCreate !== undefined && active && options !== undefined && !exact;

  function choose(option: ComboboxOption) {
    onChange(option);
    setText('');
    setClosed(false);
  }

  async function create() {
    if (!onCreate) return;
    setCreating(true);
    setCreateError(false);
    try {
      choose(await onCreate(term));
    } catch {
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  }

  function focusOption(offset: number) {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (buttons.length === 0) return;
    const index = buttons.findIndex((b) => b === document.activeElement);
    const next = buttons[Math.min(buttons.length - 1, Math.max(0, index + offset))];
    next?.focus();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && options !== undefined) {
      event.preventDefault();
      focusOption(1);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setClosed(true);
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
      );
      if (buttons[0] === document.activeElement) inputRef.current?.focus();
      else focusOption(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setClosed(true);
      inputRef.current?.focus();
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="green">{value.label}</Badge>
        {value.hint ? <span className="text-xs text-mist-500">{value.hint}</span> : null}
        <Button
          variant="secondary"
          aria-label="Clear"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Clear
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={options !== undefined}
        aria-controls={options !== undefined ? listId : undefined}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setClosed(false);
        }}
        onKeyDown={onInputKeyDown}
      />
      {suggestions.isError ? (
        <p className="text-xs text-red-700">Could not load suggestions.</p>
      ) : null}
      {options !== undefined ? (
        options.length === 0 && !showCreate ? (
          <p className="text-xs text-mist-500">{emptyMessage}</p>
        ) : (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={listLabel}
            onKeyDown={onListKeyDown}
            className="max-h-64 overflow-y-auto rounded-lg border border-canopy-700/15 bg-white py-1 text-sm shadow-sm"
          >
            {options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-mist-500">{emptyMessage}</p>
            ) : null}
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none"
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.hint ? <span className="text-xs text-mist-500">{option.hint}</span> : null}
              </button>
            ))}
            {showCreate ? (
              <button
                type="button"
                role="option"
                aria-selected={false}
                disabled={creating}
                className="flex w-full items-baseline gap-2 border-t border-canopy-700/10 px-3 py-2 text-left font-medium text-canopy-900 hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none disabled:opacity-60"
                onClick={create}
              >
                Create "{term}"
              </button>
            ) : null}
          </div>
        )
      ) : null}
      {createError ? <p className="text-xs text-red-700">Could not create it. Try again.</p> : null}
    </div>
  );
}
