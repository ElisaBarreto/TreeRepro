import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { Reference } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, fetchDictionary, searchReferences } from '../../api/dataset.ts';
import { ReferenceDialog } from '../../components/catalog/ReferenceDialog.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { articleKind, formatNumber, humaniseKey, truncate } from '../../lib/format.ts';
import { doiHref, referenceLabel } from '../../lib/references.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const KEY_MAX = 80;
const DASH = <span className="text-mist-500">—</span>;

/**
 * The category and trait filters, both search params of `/app/references`
 * (RFC-61 R4 amendment): a link from a trait or a category page narrows the
 * bibliography to what cites it, and the choice survives a reload.
 * @rfc RFC-13 R2
 * @rfc RFC-61 R4
 */
export interface ReferencesSearch {
  categoryKey?: string;
  traitId?: string;
}

/**
 * Bibliography, most cited first (the API's order, RFC-61 R4): each article
 * with how many records name it as primary and as secondary. The first page
 * lists at once; the term, debounced, narrows it once it has two letters (the
 * API's minimum) and starts over at page 1. Category and trait narrow it
 * server-side and live in the URL, fed by the whole trait dictionary so the
 * category select always offers every category regardless of the current
 * filter; choosing a category clears a trait that belonged to another one,
 * and a `?traitId=` deep link with no category derives one from the
 * dictionary, the same pattern `TraitsPage` uses. Long citation keys are cut
 * in the cell and kept whole in the link's `title`; a small badge says when
 * the key is a DOI, a numeric index or a full citation rather than a name,
 * and a DOI column links out to the registry. A New reference action, for
 * `references.manage`, opens `ReferenceDialog` and navigates to the created
 * reference on success.
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-61 R4, R6, R10
 */
export function ReferencesPage({
  search,
  onSearchChange,
}: {
  search: ReferencesSearch;
  onSearchChange: (next: ReferencesSearch) => void;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const searchId = useId();
  const ids = { category: useId(), trait: useId() };
  const term = useDebouncedValue(text.trim(), 300);
  const q = term.length >= 2 ? term : undefined;

  const vocabulary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  // A `?traitId=` deep link may name no category; the trait's own is read
  // out of the vocabulary so the selects show the filter that is in force.
  const derivedCategory = search.traitId
    ? vocabulary.data?.find((category) =>
        category.traits.some((trait) => trait.id === search.traitId),
      )?.key
    : undefined;
  const effectiveCategory = search.categoryKey ?? derivedCategory;
  const categoryTraits =
    vocabulary.data?.find((category) => category.key === effectiveCategory)?.traits ?? [];

  const params = { q, categoryKey: search.categoryKey, traitId: search.traitId };
  const list = usePagedList(datasetKeys.references(params), (cursor, limit) =>
    searchReferences({ ...params, cursor, limit }),
  );

  return (
    <>
      <PageHeader
        title="References"
        description="Articles cited by the records, most used first. Search by citation key or title."
        actions={
          hasPermission(me, 'references.manage') ? (
            <Button onClick={() => setCreating(true)}>New reference</Button>
          ) : undefined
        }
      />
      {creating ? (
        <ReferenceDialog
          onClose={() => setCreating(false)}
          onSaved={(r) => {
            setCreating(false);
            navigate({ to: '/app/references/$id', params: { id: r.id } });
          }}
        />
      ) : null}
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]">
          <Field id={searchId} label="Search references">
            <Input
              id={searchId}
              type="search"
              autoComplete="off"
              maxLength={100}
              placeholder="Citation key or title"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field id={ids.category} label="Category">
            <Select
              id={ids.category}
              value={effectiveCategory ?? ''}
              onChange={(event) =>
                onSearchChange({
                  categoryKey: event.target.value || undefined,
                  // The trait belonged to the category being left behind.
                  traitId: undefined,
                })
              }
            >
              <option value="">All categories</option>
              {(vocabulary.data ?? []).map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={ids.trait} label="Trait">
            <Select
              id={ids.trait}
              disabled={!effectiveCategory}
              value={search.traitId ?? ''}
              onChange={(event) =>
                onSearchChange({ ...search, traitId: event.target.value || undefined })
              }
            >
              <option value="">All traits</option>
              {categoryTraits.map((trait) => (
                <option key={trait.id} value={trait.id}>
                  {humaniseKey(trait.key)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Searching…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No articles match." />
        ) : null}
        {list.items.length > 0 ? <ReferenceTable items={list.items} /> : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
    </>
  );
}

function ReferenceTable({ items }: { items: Reference[] }) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Article</Th>
          <Th className="text-right">As primary</Th>
          <Th className="text-right">As secondary</Th>
          <Th>Year</Th>
          <Th>DOI / ISBN</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((reference) => {
          // How the reference reads, not the key it is stored under: a
          // personal observation names its observer (RFC-61 R4, R7), and
          // never looks like a DOI or an index to `articleKind`.
          const label = referenceLabel(reference);
          const shown = truncate(label, KEY_MAX);
          // A book's label is its citation by design (RFC-61 R10), not a key
          // pasted as one, so it is never flagged.
          const kind = reference.kind === 'book' ? null : articleKind(label);
          return (
            <Tr key={reference.id}>
              <Td>
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Link
                    to="/app/references/$id"
                    params={{ id: reference.id }}
                    title={shown === label ? undefined : label}
                    className="font-medium text-canopy-900 underline-offset-2 hover:underline"
                  >
                    {shown}
                  </Link>
                  {kind ? <Badge>{kind}</Badge> : null}
                </span>
              </Td>
              <Td className="text-right tabular-nums">{formatNumber(reference.primaryCount)}</Td>
              <Td className="text-right tabular-nums">{formatNumber(reference.secondaryCount)}</Td>
              <Td className="whitespace-nowrap">{reference.year ?? DASH}</Td>
              <Td className="break-all">
                {reference.doi ? (
                  <a
                    href={doiHref(reference.doi)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-canopy-900 underline-offset-2 hover:underline"
                  >
                    {reference.doi}
                  </a>
                ) : reference.isbn ? (
                  `ISBN ${reference.isbn}`
                ) : (
                  DASH
                )}
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
