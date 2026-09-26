import { type CreateRecordBody, isValidIsbn, type ResolveDoiResult } from '@treerepro/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { resolveDoi } from '../../api/curation.ts';
import { helpHref } from '../../content/help/href.ts';
import { Button, Field, HelpTip, Input } from '../ui/index.ts';
import { type DoiCheck, DoiField, resolvedCheck } from './DoiField.tsx';

/** A book among a claim's sources: its ISBN as typed and the citation it is recorded under. */
export type BookSource = { isbn: string; citation: string };

/**
 * The sources of a claim: the DOIs, one per row (`''` rows are blank ones),
 * and after them the books given by ISBN — absent until one is added.
 */
export type SourcesValue = { dois: string[]; books?: BookSource[] };

export interface SourcesFieldProps {
  value: SourcesValue;
  onChange(v: SourcesValue): void;
  /** Field errors keyed by the API's paths (`sources`, `sources.references.<i>.doi`). */
  errors: Record<string, string>;
  /** Told whether the sources are ready to submit; a pending or failed check is not. */
  onValidity(ready: boolean): void;
  /**
   * One optional supporting reference (Validate, spec §2): a single row, no
   * "Add another reference", and none of the personal-observation wording —
   * a blank row here means "no reference", not own field work. Since the
   * caller sends only that one row, "Add a book (ISBN)" replaces the DOI row
   * rather than joining it, and removing the book restores the blank DOI row.
   */
  single?: boolean;
}

/** The value a form starts from: one blank row. @rfc RFC-70 R1 */
export const EMPTY_SOURCES: SourcesValue = { dois: [''] };

const MAX_ROWS = 10;
const IDLE: DoiCheck = { status: 'idle' };
const HINT =
  'Leave blank if this comes from your own field work or expert knowledge; otherwise give the DOI.';

const bookFilled = (book: BookSource) => book.isbn.trim() !== '' || book.citation.trim() !== '';
// A book is never looked up (RFC-61 R10): ready once its ISBN is well-formed
// and it has a citation, or while the row is blank.
const bookReady = (book: BookSource) =>
  !bookFilled(book) || (isValidIsbn(book.isbn) !== null && book.citation.trim() !== '');

/**
 * The `sources` of the claim: the DOIs the rows hold, trimmed, blank rows
 * dropped — and no DOI at all means the contributor's own field work, which
 * the API records as their personal-observation reference. The books follow
 * the DOIs, trimmed; a blank book row is dropped.
 * @rfc RFC-70 R1
 * @rfc RFC-80 R5
 * @rfc RFC-61 R10
 */
export function sourcesToBody(value: SourcesValue): CreateRecordBody['sources'] {
  const dois = value.dois.map((doi) => doi.trim()).filter((doi) => doi !== '');
  const books = (value.books ?? [])
    .filter(bookFilled)
    .map((book) => ({ isbn: book.isbn.trim(), citation: book.citation.trim() }));
  return dois.length === 0 && books.length === 0
    ? { personalObservation: true }
    : { references: [...dois.map((doi) => ({ doi })), ...books] };
}

/**
 * One book among the sources: its ISBN and its citation. Once either field is
 * left, a row with any content says what it lacks — an ISBN, a valid one, a
 * citation; a blank row says nothing. The API checks both again (RFC-61 R10).
 * A book is never looked up, so it never waits on a check.
 */
function BookRow({
  id,
  number,
  value,
  onChange,
  onRemove,
  errors,
}: {
  id: string;
  number: number;
  value: BookSource;
  onChange(v: BookSource): void;
  onRemove(): void;
  errors: { isbn?: string; citation?: string };
}) {
  const [left, setLeft] = useState(false);
  const shown = left && bookFilled(value);
  const isbnError =
    errors.isbn ??
    (!shown
      ? undefined
      : value.isbn.trim() === ''
        ? 'Give the ISBN of the book'
        : isValidIsbn(value.isbn) === null
          ? 'Not a valid ISBN'
          : undefined);
  const citationError =
    errors.citation ??
    (shown && value.citation.trim() === '' ? 'Give the citation of the book' : undefined);
  const suffix = number === 1 ? '' : ` ${number}`;
  return (
    <div className="flex flex-col gap-2">
      <Field
        id={`${id}-isbn`}
        label={`ISBN${suffix}`}
        hint="ISBN-10 or ISBN-13"
        error={isbnError}
        trailing={
          <Button variant="secondary" size="sm" onClick={onRemove}>
            Remove
          </Button>
        }
      >
        <Input
          id={`${id}-isbn`}
          value={value.isbn}
          maxLength={20}
          placeholder="978-0-306-40615-7"
          onChange={(e) => onChange({ ...value, isbn: e.target.value })}
          onBlur={() => setLeft(true)}
          invalid={Boolean(isbnError)}
        />
      </Field>
      <Field
        id={`${id}-citation`}
        label={`Citation${suffix}`}
        hint="Authors, year, title"
        error={citationError}
      >
        <Input
          id={`${id}-citation`}
          value={value.citation}
          maxLength={2000}
          onChange={(e) => onChange({ ...value, citation: e.target.value })}
          onBlur={() => setLeft(true)}
          invalid={Boolean(citationError)}
        />
      </Field>
    </div>
  );
}

/**
 * Where a claim comes from (RFC-70 R1): the hint that a blank field means the
 * contributor's own work — it describes the rows as a group, so it is written
 * once however many rows there are — and one `DoiField` by default, up to ten,
 * numbered from the second on so the inputs can be told apart. Each is
 * checked against `GET /api/references/resolve` when it loses focus. The
 * checks are held by their trimmed DOI, not by the row, so one value is
 * resolved once however often the row is left again — unless the check itself
 * failed, which is no answer and is asked again — and adding or removing a
 * row keeps what the other rows already resolved. Every row blank is a
 * personal observation, which the line above the submit button says. The form
 * hears through `onValidity` on every change of readiness — unconditionally,
 * so a form that resets its own state while this field stays mounted is told
 * again — that it may submit: only once every non-empty row has resolved. A
 * check still in flight, or one that failed, blocks it, as the API would
 * refuse the record anyway. **Add a book (ISBN)** appends a row with an ISBN
 * and a Citation field after the DOI rows; a book is never checked against
 * the registry, so it is ready once its ISBN is well-formed and it has a
 * citation. DOI and book rows share the limit of ten.
 * @rfc RFC-70 R1
 * @rfc RFC-80 R4
 * @rfc RFC-61 R10
 */
export function SourcesField({
  value,
  onChange,
  errors,
  onValidity,
  single = false,
}: SourcesFieldProps) {
  const baseId = useId();
  const [checks, setChecks] = useState<ReadonlyMap<string, DoiCheck>>(() => new Map());
  // One request per distinct value, even for two rows blurred in the same tick.
  const requested = useRef<Set<string>>(new Set());
  const hintId = `${baseId}-hint`;

  const rows = value.dois;
  const dois = rows.map((doi) => doi.trim());
  const books = value.books ?? [];
  const checkOf = (index: number): DoiCheck => {
    const doi = dois[index] ?? '';
    return (doi === '' ? undefined : checks.get(doi)) ?? IDLE;
  };
  const ready =
    dois.every((doi) => doi === '' || checks.get(doi)?.status === 'ok') && books.every(bookReady);

  useEffect(() => onValidity(ready), [ready, onValidity]);

  async function check(doi: string) {
    if (doi === '' || requested.current.has(doi)) return;
    requested.current.add(doi);
    setChecks((prev) => new Map(prev).set(doi, { status: 'checking' }));
    let answer: ResolveDoiResult;
    // Only the request is guarded: a mistake in reading the answer is a bug to
    // see, not a DOI to blame.
    try {
      answer = await resolveDoi(doi);
    } catch (error) {
      const failure: DoiCheck =
        error instanceof ApiError && error.code === 'VALIDATION_FAILED'
          ? { status: 'malformed' }
          : { status: 'failed' };
      // Only an answer is remembered. A transport failure is not one: the row
      // says "try again", so leaving the row again asks again — the registry
      // may be back. The value stays in `requested` until the failure comes
      // back, so the retry cannot start while the request is still in flight.
      if (failure.status === 'failed') requested.current.delete(doi);
      setChecks((prev) => new Map(prev).set(doi, failure));
      return;
    }
    setChecks((prev) => new Map(prev).set(doi, resolvedCheck(answer, doi)));
  }

  // The API names a source by its position among the references it was sent
  // (RFC-70 R3), which counts the filled rows only; a blank row shifts every
  // row after it. A message about the sources as a whole lands on the first row.
  function rowError(index: number): string | undefined {
    const doi = dois[index] ?? '';
    const fallback = index === 0 ? errors.sources : undefined;
    if (doi === '') return fallback;
    const path = `sources.references.${dois.slice(0, index).filter((d) => d !== '').length}`;
    return (
      Object.entries(errors).find(([key]) => key === path || key.startsWith(`${path}.`))?.[1] ??
      fallback
    );
  }

  // Books follow the filled DOIs in the body `sourcesToBody` sends, so a
  // book's path counts every filled DOI and the filled books before it.
  function bookErrors(index: number): { isbn?: string; citation?: string } {
    const book = books[index];
    if (book === undefined || !bookFilled(book)) return {};
    const position =
      dois.filter((doi) => doi !== '').length + books.slice(0, index).filter(bookFilled).length;
    const path = `sources.references.${position}`;
    return { isbn: errors[`${path}.isbn`] ?? errors[path], citation: errors[`${path}.citation`] };
  }

  return (
    // The hint describes the rows as a group: it is about having no DOI at
    // all, which is a property of the field, not of any one row — hence the
    // fieldset it describes, rather than a hint repeated on every row.
    <fieldset className="flex flex-col gap-4" aria-describedby={single ? undefined : hintId}>
      <legend className="sr-only">Sources</legend>
      {single ? null : (
        <p id={hintId} className="flex items-start gap-1.5 text-meta text-mist-500">
          <span>{HINT}</span>
          <HelpTip learnMore={helpHref('references', 'doi')}>{HINT}</HelpTip>
        </p>
      )}
      <div className="flex flex-col gap-4">
        {rows.map((doi, index) => {
          const rowId = `${baseId}-${index}`;
          return (
            <DoiField
              key={rowId}
              id={rowId}
              label={index === 0 ? 'DOI' : `DOI ${index + 1}`}
              value={doi}
              onChange={(next) =>
                onChange({ ...value, dois: rows.map((d, i) => (i === index ? next : d)) })
              }
              check={checkOf(index)}
              onBlur={() => void check(dois[index] ?? '')}
              onRemove={
                rows.length > 1
                  ? () => onChange({ ...value, dois: rows.filter((_, i) => i !== index) })
                  : undefined
              }
              error={rowError(index)}
            />
          );
        })}
        {books.map((book, index) => {
          const rowId = `${baseId}-book-${index}`;
          return (
            <BookRow
              key={rowId}
              id={rowId}
              number={index + 1}
              value={book}
              onChange={(next) =>
                onChange({ ...value, books: books.map((b, i) => (i === index ? next : b)) })
              }
              onRemove={() =>
                single
                  ? onChange({ dois: [''], books: [] })
                  : onChange({ ...value, books: books.filter((_, i) => i !== index) })
              }
              errors={bookErrors(index)}
            />
          );
        })}
      </div>
      {(single ? books.length === 0 : rows.length + books.length < MAX_ROWS) ? (
        <div className="flex flex-wrap gap-2">
          {single ? null : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onChange({ ...value, dois: [...rows, ''] })}
            >
              Add another reference
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              // Single mode holds one source row: a book replaces the DOI
              // row rather than joining it, so `sourcesToBody` never returns
              // two references for a dialog that only sends the first.
              single
                ? onChange({ dois: [], books: [{ isbn: '', citation: '' }] })
                : onChange({ ...value, books: [...books, { isbn: '', citation: '' }] })
            }
          >
            Add a book (ISBN)
          </Button>
        </div>
      ) : null}
      {!single && dois.every((doi) => doi === '') && !books.some(bookFilled) ? (
        <p className="text-meta text-mist-500">
          This will be recorded as your personal observation
        </p>
      ) : null}
    </fieldset>
  );
}
