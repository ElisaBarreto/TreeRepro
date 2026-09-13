import { Link } from '@tanstack/react-router';
import type { Reference } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { datasetKeys, searchReferences } from '../../api/dataset.ts';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import {
  Alert,
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
import { truncate } from '../../lib/format.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const KEY_MAX = 80;
const DASH = <span className="text-mist-500">—</span>;

/**
 * Bibliography: the first page lists at once; the term, debounced, narrows
 * it once it has two letters (the API's minimum, RFC-61 R4) and starts over
 * at page 1. Long citation keys are cut in the cell and kept whole in the
 * link's `title`.
 * @rfc RFC-13 R2, R4
 * @rfc RFC-61 R4
 */
export function ReferencesPage() {
  const [text, setText] = useState('');
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
        description="Browse the bibliography, or narrow it by citation key or title."
      />
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
        {list.isLoading ? <p className="text-sm text-mist-500">Searching…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No references match." />
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
          <Th>Citation key</Th>
          <Th>Title</Th>
          <Th>Year</Th>
          <Th>Journal</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((reference) => {
          const shown = truncate(reference.citationKey, KEY_MAX);
          return (
            <Tr key={reference.id}>
              <Td>
                <Link
                  to="/app/references/$id"
                  params={{ id: reference.id }}
                  title={shown === reference.citationKey ? undefined : reference.citationKey}
                  className="font-medium text-canopy-900 underline-offset-2 hover:underline"
                >
                  {shown}
                </Link>
              </Td>
              <Td className="text-canopy-800">{reference.title ?? DASH}</Td>
              <Td className="whitespace-nowrap">{reference.year ?? DASH}</Td>
              <Td className="text-canopy-800">{reference.journal ?? DASH}</Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
