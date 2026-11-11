import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PLANT_TYPE_LABELS,
  PLANT_TYPES,
  type PlantType,
  type PlantTypeQueueItem,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import {
  confirmPlantType,
  fetchPlantTypeQueue,
  invalidateAfterCatalogWrite,
  plantTypeQueueKey,
} from '../../api/catalog.ts';
import { dashboardKeys } from '../../api/dashboard.ts';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Field,
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
import { isoDate } from '../../lib/format.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

/** Change type and confirm: the stated type preselected. Mounted only while open. */
function ChangeAndConfirmDialog({
  item,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  item: PlantTypeQueueItem;
  pending: boolean;
  error: unknown;
  onConfirm: (plantType: PlantType) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [plantType, setPlantType] = useState<PlantType>(item.plantType);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm(plantType);
  }
  return (
    <Dialog open title="Change type and confirm" onClose={onClose} closeDisabled={pending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-body text-mist-700">
          <em>{item.canonicalName}</em>
        </p>
        <Field id={id} label="Plant type">
          <Select
            id={id}
            value={plantType}
            onChange={(event) => setPlantType(event.target.value as PlantType)}
          >
            {PLANT_TYPES.map((type) => (
              <option key={type} value={type}>
                {PLANT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        {error ? <Alert tone="error">{pageErrorMessage(error)}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" pending={pending}>
            Confirm
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The plant-type review queue (RFC-65 R20): the species whose type is still
 * `proposed`, oldest first, the same on both platforms (RFC-33 R11). Each row
 * is confirmed as stated, or changed and confirmed; a confirmed species leaves
 * the queue.
 * @rfc RFC-13 R2, R3
 * @rfc RFC-65 R20
 */
export function PlantTypesPage() {
  const queryClient = useQueryClient();
  const [changing, setChanging] = useState<PlantTypeQueueItem | null>(null);
  const list = usePagedList(plantTypeQueueKey, (cursor, limit) =>
    fetchPlantTypeQueue({ cursor, limit }),
  );
  const confirm = useMutation({
    mutationFn: ({ id, plantType }: { id: string; plantType?: PlantType }) =>
      confirmPlantType(id, plantType),
    onSuccess: async () => {
      setChanging(null);
      // The queue sits under `species`, as does every species list it changes.
      await Promise.all([
        invalidateAfterCatalogWrite(queryClient, 'taxa'),
        queryClient.invalidateQueries({ queryKey: dashboardKeys.mine }),
      ]);
    },
  });

  return (
    <>
      <PageHeader
        title="Plant types"
        description="Species whose plant type has not been reviewed yet. Confirming one marks its type reviewed; TreeRepro shows a species only once it is a reviewed tree."
      />
      <div className="flex flex-col gap-6">
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {confirm.isError && !changing ? (
          <Alert tone="error">{pageErrorMessage(confirm.error)}</Alert>
        ) : null}
        {list.isLoading ? <p className="text-body text-mist-500">Loading species…</p> : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState title="No species is waiting for a plant-type review." />
        ) : null}
        {list.items.length > 0 ? (
          <Table>
            <Thead>
              <Tr>
                <Th>Species</Th>
                <Th>Family</Th>
                <Th>Stated type</Th>
                <Th>Proposed by</Th>
                <Th>Added</Th>
                <Th>Note</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {list.items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    <em>{item.canonicalName}</em>
                  </Td>
                  <Td>{item.family?.name ?? '—'}</Td>
                  <Td>{PLANT_TYPE_LABELS[item.plantType]}</Td>
                  <Td>{item.createdBy?.name ?? '—'}</Td>
                  <Td className="tabular-nums">{isoDate(item.createdAt)}</Td>
                  <Td>{item.note ?? '—'}</Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        pending={
                          confirm.isPending && confirm.variables?.id === item.id && !changing
                        }
                        disabled={confirm.isPending}
                        onClick={() => confirm.mutate({ id: item.id })}
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={confirm.isPending}
                        onClick={() => {
                          confirm.reset();
                          setChanging(item);
                        }}
                      >
                        Change type and confirm
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
      {changing ? (
        <ChangeAndConfirmDialog
          item={changing}
          pending={confirm.isPending}
          error={confirm.error}
          onConfirm={(plantType) => confirm.mutate({ id: changing.id, plantType })}
          onClose={() => {
            confirm.reset();
            setChanging(null);
          }}
        />
      ) : null}
    </>
  );
}
