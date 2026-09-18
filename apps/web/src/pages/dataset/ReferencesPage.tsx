import { Link, useNavigate } from '@tanstack/react-router';
import type { Reference } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, searchReferences } from '../../api/dataset.ts';
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
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { articleKind, formatNumber, truncate } from '../../lib/format.ts';
import { referenceLabel } from '../../lib/references.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const KEY_MAX = 80;
const DASH = <span className="text-mist-500">—</span>;

/**
 * Bibliography, most cited first (the API's order, RFC-61 R4): each article
 * with how many records name it as primary and as secondary. The first page
 * lists at once; the term, debounced, narrows it once it has two letters (the
 * API's minimum) and starts over at page 1. Long citation keys are cut in the
 * cell and kept whole in the link's `title`; a small badge says when the key
 * is a DOI, a numeric index or a full citation rather than a name. A New
 * reference action, for `references.manage`, opens `ReferenceDialog` and
 * navigates to the created reference on success.
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-61 R4, R6
 */
export function ReferencesPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const searchId = useId();
  const term = useDebouncedValue(text.trim(), 300);
  const q = term.length >= 2 ? term : undefined;
  const list = usePagedList(datasetKeys.references({ q }), (cursor, limit) =>
    searchReferences({ q, cursor, limit }),
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
        <div className="max-w-md">
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
        </Tr>
      </Thead>
      <Tbody>
        {items.map((reference) => {
          // How the reference reads, not the key it is stored under: a
          // personal observation names its observer (RFC-61 R4, R7), and
          // never looks like a DOI or an index to `articleKind`.
          const label = referenceLabel(reference);
          const shown = truncate(label, KEY_MAX);
          const kind = articleKind(label);
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
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
