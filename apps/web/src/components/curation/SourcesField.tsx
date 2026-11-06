import {
  type CreateRecordBody,
  isValidIsbn,
  isWebUrl,
  type ResolveDoiResult,
} from '@treerepro/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { resolveDoi } from '../../api/curation.ts';
import { helpHref } from '../../content/help/href.ts';
import { Button, Field, HelpTip, Input } from '../ui/index.ts';
import { type DoiCheck, DoiField, resolvedCheck } from './DoiField.tsx';

/** A book among a claim's sources: its ISBN as typed and the citation it is recorded under. */
export type BookSource = { isbn: string; citation: string };
/** A web page among a claim's sources: its address as typed and its citation. */
export type WebsiteSource = { url: string; citation: string };

/**
 * The sources of a claim: the DOIs, one per row (`''` rows are blank ones),
 * then the books given by ISBN and the websites given by address — each
 * absent until one is added.
 */
export type SourcesValue = { dois: string[]; books?: BookSource[]; websites?: WebsiteSource[] };

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
  'Leave blank if this comes from your own field work or expert knowledge; otherwise give the DOI, the book or the website.';

/**
 * A source given by a key and a citation, never looked up: a book by ISBN
 * (RFC-61 R10) or a web page by address (R11). The row's labels and the
 * sentences it says when something is missing or malformed.
 */
interface CitedKind {
  label: string;
  citationLabel: string;
  hint: string;
  citationHint: string;
  placeholder: string;
  maxLength: number;
  valid(key: string): boolean;
  missing: string;
  invalid: string;
  citationMissing: string;
}
type CitedSource = { key: string; citation: string };

const BOOK: CitedKind = {
  label: 'ISBN',
  citationLabel: 'Citation',
  hint: 'ISBN-10 or ISBN-13',
  citationHint: 'Authors, year, title',
  placeholder: '978-0-306-40615-7',
  maxLength: 20,
  valid: (isbn) => isValidIsbn(isbn) !== null,
  missing: 'Give the ISBN of the book',
  invalid: 'Not a valid ISBN',
  citationMissing: 'Give the citation of the book',
};
const WEBSITE: CitedKind = {
  label: 'Web address',
  citationLabel: 'Page citation',
  hint: 'The page address, starting with https://',
  citationHint: 'Author or organisation, year, page title',
  placeholder: 'https://',
  maxLength: 500,
  valid: (url) => isWebUrl(url.trim()),
  missing: 'Give the address of the page',
  invalid: 'Give an http or https address',
  citationMissing: 'Give the citation of the page',
};

const citedFilled = (source: CitedSource) =>
  source.key.trim() !== '' || source.citation.trim() !== '';
// Never looked up: ready once its key is well-formed and it has a citation,
// or while the row is blank.
const citedReady = (kind: CitedKind, source: CitedSource) =>
  !citedFilled(source) || (kind.valid(source.key) && source.citation.trim() !== '');
const bookFilled = (book: BookSource) => citedFilled({ key: book.isbn, citation: book.citation });
const websiteFilled = (page: WebsiteSource) =>
  citedFilled({ key: page.url, citation: page.citation });

/**
 * The `sources` of the claim: the DOIs the rows hold, trimmed, blank rows
 * dropped — and no DOI at all means the contributor's own field work, which
 * the API records as their personal-observation reference. The books follow
 * the DOIs and the websites the books, trimmed; a blank row is dropped.
 * @rfc RFC-70 R1
 * @rfc RFC-80 R5
 * @rfc RFC-61 R10, R11
 */
export function sourcesToBody(value: SourcesValue): CreateRecordBody['sources'] {
  const dois = value.dois.map((doi) => doi.trim()).filter((doi) => doi !== '');
  const books = (value.books ?? [])
    .filter(bookFilled)
    .map((book) => ({ isbn: book.isbn.trim(), citation: book.citation.trim() }));
  const websites = (value.websites ?? [])
    .filter(websiteFilled)
    .map((page) => ({ url: page.url.trim(), citation: page.citation.trim() }));
  return dois.length === 0 && books.length === 0 && websites.length === 0
    ? { personalObservation: true }
    : { references: [...dois.map((doi) => ({ doi })), ...books, ...websites] };
}

/**
 * One book or web page among the sources: its key (ISBN or address) and its
 * citation. Once either field is left, a row with any content says what it
 * lacks; a blank row says nothing. The API checks both again (RFC-61 R10,
 * R11). It is never looked up, so it never waits on a check.
 */
function CitedRow({
  id,
  kind,
  number,
  value,
  onChange,
  onRemove,
  errors,
}: {
  id: string;
  kind: CitedKind;
  number: number;
  value: CitedSource;
  onChange(v: CitedSource): void;
  onRemove(): void;
  errors: { key?: string; citation?: string };
}) {
  const [left, setLeft] = useState(false);
  const shown = left && citedFilled(value);
  const keyError =
    errors.key ??
    (!shown
      ? undefined
      : value.key.trim() === ''
        ? kind.missing
        : !kind.valid(value.key)
          ? kind.invalid
          : undefined);
  const citationError =
    errors.citation ?? (shown && value.citation.trim() === '' ? kind.citationMissing : undefined);
  const suffix = number === 1 ? '' : ` ${number}`;
  return (
    <div className="flex flex-col gap-2">
      <Field
        id={`${id}-key`}
        label={`${kind.label}${suffix}`}
        hint={kind.hint}
        error={keyError}
        trailing={
          <Button variant="secondary" size="sm" onClick={onRemove}>
            Remove
          </Button>
        }
      >
        <Input
          id={`${id}-key`}
          value={value.key}
          maxLength={kind.maxLength}
          placeholder={kind.placeholder}
          onChange={(e) => onChange({ ...value, key: e.target.value })}
          onBlur={() => setLeft(true)}
          invalid={Boolean(keyError)}
        />
      </Field>
      <Field
        id={`${id}-citation`}
        label={`${kind.citationLabel}${suffix}`}
        hint={kind.citationHint}
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
 * citation. **Add a website** does the same with a Web address and a Page
 * citation (RFC-61 R11), ready once the address is an http or https URL.
 * DOI, book and website rows share the limit of ten.
 * @rfc RFC-70 R1
 * @rfc RFC-80 R4
 * @rfc RFC-61 R10, R11
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
  const websites = value.websites ?? [];
  const checkOf = (index: number): DoiCheck => {
    const doi = dois[index] ?? '';
    return (doi === '' ? undefined : checks.get(doi)) ?? IDLE;
  };
  const ready =
    dois.every((doi) => doi === '' || checks.get(doi)?.status === 'ok') &&
    books.every((book) => citedReady(BOOK, { key: book.isbn, citation: book.citation })) &&
    websites.every((page) => citedReady(WEBSITE, { key: page.url, citation: page.citation }));

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

  // Books follow the filled DOIs in the body `sourcesToBody` sends, and
  // websites the filled books, so a row's path counts every filled row before
  // it.
  function citedErrors(position: number, field: string): { key?: string; citation?: string } {
    const path = `sources.references.${position}`;
    return {
      key: errors[`${path}.${field}`] ?? errors[path],
      citation: errors[`${path}.citation`],
    };
  }
  const filledDois = dois.filter((doi) => doi !== '').length;
  const filledBooks = books.filter(bookFilled).length;
  const extras = books.length + websites.length;

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
            <CitedRow
              key={rowId}
              id={rowId}
              kind={BOOK}
              number={index + 1}
              value={{ key: book.isbn, citation: book.citation }}
              onChange={(next) => {
                const updated = { isbn: next.key, citation: next.citation };
                onChange({ ...value, books: books.map((b, i) => (i === index ? updated : b)) });
              }}
              onRemove={() =>
                single
                  ? onChange({ dois: [''], books: [] })
                  : onChange({ ...value, books: books.filter((_, i) => i !== index) })
              }
              errors={
                bookFilled(book)
                  ? citedErrors(
                      filledDois + books.slice(0, index).filter(bookFilled).length,
                      'isbn',
                    )
                  : {}
              }
            />
          );
        })}
        {websites.map((page, index) => {
          const rowId = `${baseId}-website-${index}`;
          return (
            <CitedRow
              key={rowId}
              id={rowId}
              kind={WEBSITE}
              number={index + 1}
              value={{ key: page.url, citation: page.citation }}
              onChange={(next) => {
                const updated = { url: next.key, citation: next.citation };
                onChange({
                  ...value,
                  websites: websites.map((w, i) => (i === index ? updated : w)),
                });
              }}
              onRemove={() =>
                single
                  ? onChange({ dois: [''], websites: [] })
                  : onChange({ ...value, websites: websites.filter((_, i) => i !== index) })
              }
              errors={
                websiteFilled(page)
                  ? citedErrors(
                      filledDois +
                        filledBooks +
                        websites.slice(0, index).filter(websiteFilled).length,
                      'url',
                    )
                  : {}
              }
            />
          );
        })}
      </div>
      {(single ? extras === 0 : rows.length + extras < MAX_ROWS) ? (
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              // As a book: in single mode the website replaces the DOI row.
              single
                ? onChange({ dois: [], websites: [{ url: '', citation: '' }] })
                : onChange({ ...value, websites: [...websites, { url: '', citation: '' }] })
            }
          >
            Add a website
          </Button>
        </div>
      ) : null}
      {!single &&
      dois.every((doi) => doi === '') &&
      !books.some(bookFilled) &&
      !websites.some(websiteFilled) ? (
        <p className="text-meta text-mist-500">
          This will be recorded as your personal observation
        </p>
      ) : null}
    </fieldset>
  );
}
