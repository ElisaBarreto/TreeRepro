import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchPlot, fetchPlotUsers, plotKeys } from '../../api/plots.ts';
import { PlotDialog } from '../../components/admin/PlotDialog.tsx';
import { PlotSpeciesSection } from '../../components/admin/PlotSpeciesSection.tsx';
import { UserStatusBadge } from '../../components/admin/UserStatusBadge.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { useBreadcrumb } from '../../components/shell/Breadcrumb.tsx';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Section,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { detailErrorMessage } from '../../lib/errors.ts';
import { isoDate } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

/**
 * Field plot detail page: metadata, edit plot dialog, species section, users
 * section. The plot's title is registered as the shell's trailing crumb, so
 * the breadcrumb reads `Admin › Plots › <code> — <name>` once the plot
 * resolved (RFC-13 R3).
 * @rfc RFC-67 R3, R4, R5
 * @rfc RFC-13 R2, R3
 */
export function PlotPage({ id }: { id: string }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const canManage = hasPermission(me, 'plots.manage');

  const [editing, setEditing] = useState(false);

  const plotQuery = useQuery({
    queryKey: plotKeys.detail(id),
    queryFn: () => fetchPlot(id),
  });

  useBreadcrumb(
    plotQuery.data ? [{ label: `${plotQuery.data.code} — ${plotQuery.data.name}` }] : [],
  );

  const usersList = usePagedList(
    plotKeys.users(id, {}),
    (cursor, limit) => fetchPlotUsers(id, { cursor, limit }),
    { enabled: canManage },
  );

  if (plotQuery.isPending) return <p className="text-body text-mist-500">Loading…</p>;
  if (plotQuery.isError) {
    return (
      <Alert tone="error">
        {detailErrorMessage(plotQuery.error, 'PLOT_NOT_FOUND', 'This plot does not exist.')}
      </Alert>
    );
  }

  const plot = plotQuery.data;

  return (
    <>
      <PageHeader
        title={`${plot.code} — ${plot.name}`}
        description={plot.description || 'No description provided.'}
        actions={canManage ? <Button onClick={() => setEditing(true)}>Edit plot</Button> : null}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {plot.country ? <Badge>{plot.country}</Badge> : null}
        {plot.biome ? <Badge tone="neutral">{plot.biome}</Badge> : null}
        {plot.latitude !== null && plot.longitude !== null ? (
          <Badge tone="green">{`${plot.latitude}, ${plot.longitude}`}</Badge>
        ) : null}
        <Badge>{`Created ${isoDate(plot.createdAt)}`}</Badge>
      </div>

      <div className="flex flex-col gap-8">
        <PlotSpeciesSection
          plotId={plot.id}
          canManage={canManage}
          onSpeciesChanged={() => {
            void queryClient.invalidateQueries({ queryKey: plotKeys.detail(plot.id) });
          }}
        />

        {canManage ? (
          <Section
            id="users"
            title="Assigned Users"
            description="Users with this field plot assigned to their account."
          >
            <div className="flex flex-col gap-4">
              {usersList.error ? <Alert tone="error">Could not load assigned users.</Alert> : null}
              {usersList.isLoading ? (
                <p className="text-body text-mist-500">Loading users…</p>
              ) : null}
              {!usersList.isLoading && !usersList.error && usersList.items.length === 0 ? (
                <EmptyState title="No users assigned to this plot." />
              ) : null}

              {usersList.items.length > 0 ? (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Name</Th>
                      <Th>Email</Th>
                      <Th>Status</Th>
                      <Th>Scope</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {usersList.items.map((u) => (
                      <Tr key={u.id}>
                        <Td>
                          <Link
                            to="/app/admin/users/$id"
                            params={{ id: u.id }}
                            className="font-medium text-canopy-900 underline-offset-2 hover:underline"
                          >
                            {u.name}
                          </Link>
                        </Td>
                        <Td>{u.email}</Td>
                        <Td>
                          <UserStatusBadge status={u.status} />
                        </Td>
                        <Td>
                          {u.restricted ? (
                            <Badge tone="amber">Restricted</Badge>
                          ) : (
                            <span className="text-meta text-mist-500">Unrestricted</span>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              ) : null}

              {usersList.items.length > 0 || usersList.page > 1 ? (
                <Pagination pager={usersList} />
              ) : null}
            </div>
          </Section>
        ) : null}
      </div>

      {editing ? (
        <PlotDialog
          plot={plot}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            queryClient.setQueryData(plotKeys.detail(plot.id), saved);
            void queryClient.invalidateQueries({ queryKey: plotKeys.all });
          }}
        />
      ) : null}
    </>
  );
}
