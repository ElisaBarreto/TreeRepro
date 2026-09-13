import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type MapPendingBody,
  type MapResult,
  mapPendingBodySchema,
  type PendingGroup,
  type TraitLevel,
  type TraitRef,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { curationKeys, invalidateAfterRecordWrite, mapPending } from '../../api/curation.ts';
import { fieldErrors, pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { Alert, Button, Dialog, Field, Input, Textarea } from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function mapErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'TRAIT_NOT_FOUND') return 'This trait no longer exists. Reload the page.';
    if (error.code === 'VALIDATION_FAILED') return 'Check the highlighted fields.';
  }
  return pageErrorMessage(error);
}

/**
 * Bulk mapping of one pending group (RFC-65 R9): the active levels to map
 * to (one or several, so `a;b` becomes two records per row) or the number
 * for a quantitative trait, and an optional note copied to every record.
 * Mounted only while open.
 * @rfc RFC-13 R6
 * @rfc RFC-65 R9
 */
export function MapDialog({
  trait,
  levels,
  group,
  onClose,
  onMapped,
}: {
  trait: TraitRef;
  levels: TraitLevel[];
  group: PendingGroup;
  onClose: () => void;
  onMapped: (result: MapResult) => void;
}) {
  const queryClient = useQueryClient();
  const ids = { numeric: useId(), note: useId() };
  const [chosen, setChosen] = useState<string[]>([]);
  const [numeric, setNumeric] = useState('');
  const [note, setNote] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const active = levels.filter((l) => l.active);
  const map = useMutation({
    mutationFn: (body: MapPendingBody) => mapPending(body),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: curationKeys.pendingTraits }),
        queryClient.invalidateQueries({ queryKey: curationKeys.pendingGroups(trait.id) }),
        invalidateAfterRecordWrite(queryClient),
      ]);
      onMapped(result);
    },
  });
  const errors = { ...fieldErrors(map.error), ...local };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = {
      traitId: trait.id,
      valueText: group.valueText,
      value:
        trait.valueType === 'categorical'
          ? { levelIds: chosen }
          : { numeric: numeric === '' ? Number.NaN : Number(numeric) },
      note: note.trim() || undefined,
    };
    const parsed = mapPendingBodySchema.safeParse(candidate);
    if (!parsed.success) {
      map.reset();
      setLocal(
        trait.valueType === 'categorical'
          ? { value: 'Choose at least one level.' }
          : { value: 'Enter a number.' },
      );
      return;
    }
    setLocal({});
    map.mutate(parsed.data);
  }

  const valueError = errors['value.levelId'] ?? errors['value.numeric'] ?? errors.value;
  return (
    <Dialog open title={`Map "${group.valueText}"`} onClose={onClose} closeDisabled={map.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-meta text-mist-500">
          {humaniseKey(trait.key)} · {group.count} {group.count === 1 ? 'record' : 'records'} ·{' '}
          {group.harmonisation.replace('_', ' ')}
        </p>
        {trait.valueType === 'categorical' ? (
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={valueError ? `${ids.numeric}-error` : undefined}
          >
            <legend className="text-label font-bold uppercase tracking-[0.08em] text-canopy-800">
              Levels
            </legend>
            {active.map((level) => (
              <label key={level.id} className="flex items-center gap-2 text-body text-canopy-950">
                <input
                  type="checkbox"
                  className="size-4 accent-pollen-500"
                  checked={chosen.includes(level.id)}
                  onChange={(e) =>
                    setChosen((prev) =>
                      e.target.checked ? [...prev, level.id] : prev.filter((id) => id !== level.id),
                    )
                  }
                />
                {level.key}
              </label>
            ))}
            {active.length === 0 ? (
              <p className="text-meta text-mist-500">This trait has no active levels.</p>
            ) : null}
            {valueError ? (
              <p id={`${ids.numeric}-error`} className="text-meta text-red-700">
                {valueError}
              </p>
            ) : null}
          </fieldset>
        ) : (
          <Field
            id={ids.numeric}
            label={trait.unit ? `Number (${trait.unit})` : 'Number'}
            error={valueError}
          >
            <Input
              id={ids.numeric}
              type="number"
              step="any"
              inputMode="decimal"
              value={numeric}
              onChange={(e) => setNumeric(e.target.value)}
              invalid={Boolean(valueError)}
            />
          </Field>
        )}
        <Field id={ids.note} label="Note (optional)" error={errors.note}>
          <Textarea
            id={ids.note}
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {map.isError ? <Alert tone="error">{mapErrorMessage(map.error)}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={map.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={map.isPending}>
            Map records
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
