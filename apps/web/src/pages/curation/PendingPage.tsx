import { useQuery } from '@tanstack/react-query';
import type { MapResult, PendingGroup, PendingTrait } from '@treerepro/contracts';
import { useState } from 'react';
import { curationKeys, fetchPendingGroups, fetchPendingTraits } from '../../api/curation.ts';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
import { MapDialog } from '../../components/curation/MapDialog.tsx';
import { HarmonisationBadge } from '../../components/dataset/HarmonisationBadge.tsx';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import {
  Alert,
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

/**
 * The harmonisation queue (RFC-65 R7–R9): the traits with pending import
 * values on the left, the selected trait's groups on the right, each with a
 * sample record and — with `records.create` — a Map action that turns the
 * whole group into harmonised records. The selected trait is the URL's
 * `?traitId=` (the route owns it, so a link can open the queue on a trait
 * and the choice survives a reload); a trait the queue no longer lists
 * falls back to the first, leaving the URL as it is.
 * @rfc RFC-13 R2, R3
 * @rfc RFC-65 R7, R8, R9
 */
export function PendingPage({
  traitId: chosenId,
  onSelectTrait,
}: {
  traitId: string | undefined;
  onSelectTrait: (traitId: string) => void;
}) {
  const me = useMe();
  const canMap = hasPermission(me, 'records.create');
  const traits = useQuery({ queryKey: curationKeys.pendingTraits, queryFn: fetchPendingTraits });
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const selected: PendingTrait | undefined =
    traits.data?.find((t) => t.trait.id === chosenId) ?? traits.data?.[0];
  const traitId = selected?.trait.id ?? '';
  const groups = usePagedList(
    curationKeys.pendingGroups(traitId),
    (cursor, limit) => fetchPendingGroups({ traitId, cursor, limit }),
    { enabled: traitId !== '' },
  );
  const [mapping, setMapping] = useState<PendingGroup | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [result, setResult] = useState<MapResult | null>(null);
  // `undefined` while the dictionary loads, so the Map dialog can say so;
  // once loaded, a trait the dictionary does not list has no levels.
  const levels = dictionary.data
    ? (dictionary.data.flatMap((c) => c.traits).find((t) => t.id === traitId)?.levels ?? [])
    : undefined;

  return (
    <>
      <PageHeader
        title="Pending harmonisation"
        description="Import values the dictionary did not match, grouped by trait and value. Map a group to its level or number to create harmonised records."
      />
      {traits.isError ? <Alert tone="error">{pageErrorMessage(traits.error)}</Alert> : null}
      {result ? (
        <div className="mb-4">
          <Alert tone="success">{`Mapped: ${result.created} records created, ${result.skipped} skipped.`}</Alert>
        </div>
      ) : null}
      {traits.isSuccess && traits.data.length === 0 ? (
        <EmptyState title="Nothing is pending harmonisation." />
      ) : null}
      {traits.data && traits.data.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
          <ul aria-label="Traits with pending values" className="flex flex-col gap-1">
            {traits.data.map((entry) => (
              <li key={entry.trait.id}>
                <button
                  type="button"
                  aria-pressed={entry.trait.id === traitId}
                  onClick={() => onSelectTrait(entry.trait.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-body text-canopy-900 hover:bg-mist-100 aria-pressed:bg-canopy-200/60 aria-pressed:font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                >
                  <span>{humaniseKey(entry.trait.key)}</span>
                  <span className="tabular-nums text-mist-500">{entry.count}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-4">
            {selected ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-section font-semibold text-canopy-950">
                  {humaniseKey(selected.trait.key)}
                  {selected.trait.unit ? (
                    <span className="text-mist-500"> · {selected.trait.unit}</span>
                  ) : null}
                </h2>
                {selected.trait.valueType === 'categorical' &&
                hasPermission(me, 'traits.manage') ? (
                  <ButtonLink to="/app/traits" size="sm">
                    Manage levels
                  </ButtonLink>
                ) : null}
              </div>
            ) : null}
            {groups.error ? <Alert tone="error">{pageErrorMessage(groups.error)}</Alert> : null}
            {groups.isLoading ? <p className="text-body text-mist-500">Loading groups…</p> : null}
            {groups.items.length > 0 ? (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Value</Th>
                    <Th>Kind</Th>
                    <Th>Records</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {groups.items.map((group) => (
                    <Tr key={group.valueText}>
                      <Td className="font-medium text-canopy-950">{group.valueText}</Td>
                      <Td>
                        <HarmonisationBadge status={group.harmonisation} />
                      </Td>
                      <Td className="tabular-nums">{group.count}</Td>
                      <Td>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSample(group.sampleRecordId)}
                          >
                            View sample
                          </Button>
                          {canMap && selected ? (
                            <Button size="sm" onClick={() => setMapping(group)}>
                              Map
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : null}
            {!groups.isLoading && !groups.error && groups.items.length === 0 && traitId ? (
              <EmptyState title="No pending values for this trait." />
            ) : null}
            {groups.items.length > 0 || groups.page > 1 ? <Pagination pager={groups} /> : null}
          </div>
        </div>
      ) : null}
      <RecordDrawer recordId={sample} onClose={() => setSample(null)} onOpenRecord={setSample} />
      {mapping && selected ? (
        <MapDialog
          trait={selected.trait}
          levels={levels}
          levelsError={dictionary.isError}
          group={mapping}
          onClose={() => setMapping(null)}
          onMapped={(mapped) => {
            setMapping(null);
            setResult(mapped);
          }}
        />
      ) : null}
    </>
  );
}
