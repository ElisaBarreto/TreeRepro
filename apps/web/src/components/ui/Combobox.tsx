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
  /** Set by `Field` on its child; forwarded to the input and to the Clear button of a chosen value. */
  'aria-describedby'?: string;
}

/**
 * Text input with an asynchronous suggestion list. The list is a
 * `<div role="listbox">` of `<button role="option">` (docs/gotchas/web.md):
 * ArrowDown moves focus from the input to the first option, the arrows move
 * between options, Enter or a click selects, Escape closes the list and
 * returns to the input. Escape and Enter are handled only while the list is
 * open: otherwise Escape reaches the enclosing dialog or drawer, and Enter
 * submits the form as usual. A chosen value replaces the input with a badge and
 * a Clear button, as the genus filter of the species search does. When the
 * caller passes `onCreate` and the term's own results (not the previous
 * term's, kept on screen while they load) match it exactly nowhere, a last
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
  'aria-describedby': describedBy,
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
  // `options` keeps the previous term's list on screen while the next term
  // loads (placeholder data); the create option and the exact-match check
  // wait for the current term's own results, so the offer never comes from
  // a list that is not this term's.
  const options = active ? suggestions.data : undefined;
  const settled = suggestions.isPlaceholderData ? undefined : options;
  const exact = settled?.some((o) => o.label.toLowerCase() === term.toLowerCase()) ?? false;
  const showCreate = onCreate !== undefined && settled !== undefined && !exact;
  // The listbox itself only renders when there is something to show; drive
  // aria-expanded/aria-controls off this instead of `options !== undefined`
  // so they never point at an id that is not in the DOM (e.g. the empty
  // message with no onCreate).
  const listOpen = options !== undefined && (options.length > 0 || showCreate);

  function choose(option: ComboboxOption) {
    onChange(option);
    setText('');
    setCreateError(false);
    // Keeps the list closed until the next keystroke, so the debounced term
    // (still the previous search for up to 300 ms) cannot reopen it with
    // stale results once the caller clears the chosen value.
    setClosed(true);
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
    if (!listOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setClosed(true);
    } else if (event.key === 'Enter') {
      // The list is the thing Enter acts on here, not the form.
      event.preventDefault();
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
        {value.hint ? <span className="text-meta text-mist-500">{value.hint}</span> : null}
        <Button
          variant="secondary"
          size="sm"
          aria-label="Clear"
          aria-describedby={describedBy}
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
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setClosed(false);
          setCreateError(false);
        }}
        onKeyDown={onInputKeyDown}
      />
      {suggestions.isError ? (
        <p className="text-meta text-red-700">Could not load suggestions.</p>
      ) : null}
      {options !== undefined ? (
        options.length === 0 && !showCreate ? (
          <p className="text-meta text-mist-500">{emptyMessage}</p>
        ) : (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={listLabel}
            onKeyDown={onListKeyDown}
            className="max-h-64 overflow-y-auto rounded-[10px] border border-canopy-700/15 bg-white py-1 text-cell shadow-sm"
          >
            {options.length === 0 ? (
              <p className="px-3.5 py-2.5 text-meta text-mist-500">{emptyMessage}</p>
            ) : null}
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-baseline gap-2 px-3.5 py-2.5 text-left hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none"
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.hint ? (
                  <span className="text-meta text-mist-500">{option.hint}</span>
                ) : null}
              </button>
            ))}
            {showCreate ? (
              <button
                type="button"
                role="option"
                aria-selected={false}
                disabled={creating}
                className="flex w-full items-baseline gap-2 border-t border-canopy-700/10 px-3.5 py-2.5 text-left font-medium text-canopy-900 hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none disabled:opacity-60"
                onClick={create}
              >
                Create "{term}"
              </button>
            ) : null}
          </div>
        )
      ) : null}
      {createError ? (
        <p className="text-meta text-red-700">Could not create it. Try again.</p>
      ) : null}
    </div>
  );
}
