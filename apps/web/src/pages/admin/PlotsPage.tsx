import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { listPlots, plotKeys } from '../../api/plots.ts';
import { PlotDialog } from '../../components/admin/PlotDialog.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { NoPermission } from '../../components/shell/NoPermission.tsx';
import {
  Alert,
  Button,
  EmptyState,
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
import { hasPermission, useMe } from '../../lib/session.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const DASH = <span className="text-mist-500">—</span>;

/**
 * Lists field plots, ordered by code (RFC-67 R3).
 * Requires `plots.manage`; shows NoPermission otherwise.
 * @rfc RFC-67 R3
 * @rfc RFC-13 R2, R3
 */
export function PlotsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const canManage = hasPermission(me, 'plots.manage');

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q.trim(), 300);
  const filter = { q: debouncedQ || undefined };

  const [creating, setCreating] = useState(false);

  const list = usePagedList(
    plotKeys.list(filter),
    (cursor, limit) => listPlots({ ...filter, cursor, limit }),
    { enabled: canManage },
  );

  if (!canManage) return <NoPermission />;

  return (
    <>
      <PageHeader
        title="Plots"
        description="Field plots and their species."
        actions={<Button onClick={() => setCreating(true)}>New plot</Button>}
      />

      <div className="flex flex-col gap-6">
        <div className="max-w-xs">
          <Input
            type="search"
            placeholder="Search plots by code or name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No plots match." />
        ) : null}

        {list.items.length > 0 ? (
          <Table>
            <Thead>
              <Tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Country</Th>
                <Th>Biome</Th>
                <Th>Species</Th>
              </Tr>
            </Thead>
            <Tbody>
              {list.items.map((plot) => (
                <Tr key={plot.id}>
                  <Td>
                    <Link
                      to="/app/admin/plots/$id"
                      params={{ id: plot.id }}
                      className="font-mono font-medium text-canopy-900 underline-offset-2 hover:underline"
                    >
                      {plot.code}
                    </Link>
                  </Td>
                  <Td>{plot.name}</Td>
                  <Td>{plot.country ?? DASH}</Td>
                  <Td>{plot.biome ?? DASH}</Td>
                  <Td>{plot.speciesCount}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        ) : null}

        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>

      {creating ? (
        <PlotDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: plotKeys.all });
          }}
        />
      ) : null}
    </>
  );
}
