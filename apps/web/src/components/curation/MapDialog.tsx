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
import { mapPending } from '../../api/curation.ts';
import { fieldErrors, pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { useRecordWrite } from '../../lib/use-record-write.ts';
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
 * The levels come from the dictionary the page loads: while it is still
 * loading (`levels` undefined) the dialog says so and keeps Map disabled,
 * instead of reading as a trait without levels; `levelsError` says the
 * dictionary failed. Mounted only while open.
 * @rfc RFC-13 R6
 * @rfc RFC-65 R9
 */
export function MapDialog({
  trait,
  levels,
  levelsError = false,
  group,
  onClose,
  onMapped,
}: {
  trait: TraitRef;
  /** The trait's levels; `undefined` while the dictionary loads. */
  levels: TraitLevel[] | undefined;
  levelsError?: boolean;
  group: PendingGroup;
  onClose: () => void;
  onMapped: (result: MapResult) => void;
}) {
  const ids = { numeric: useId(), note: useId() };
  const [chosen, setChosen] = useState<string[]>([]);
  const [numeric, setNumeric] = useState('');
  const [note, setNote] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const active = levels?.filter((l) => l.active);
  // The pending queues live under `['records', …]`, which the write's
  // invalidation covers; no species id, a mapping touches every species.
  const map = useRecordWrite<MapPendingBody, MapResult>({
    write: mapPending,
    onInvalidated: onMapped,
  });
  const levelsReady = trait.valueType !== 'categorical' || active !== undefined;
  const errors = { ...fieldErrors(map.error), ...local };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The empty cases get a fixed sentence; anything else the schema rejects
    // (a number out of range, a note too long) shows the schema's own
    // message under its field, as AddEntriesDialog does.
    const empty = trait.valueType === 'categorical' ? chosen.length === 0 : numeric === '';
    if (empty) {
      map.reset();
      setLocal({
        value: trait.valueType === 'categorical' ? 'Choose at least one level.' : 'Enter a number.',
      });
      return;
    }
    const candidate = {
      traitId: trait.id,
      valueText: group.valueText,
      value:
        trait.valueType === 'categorical' ? { levelIds: chosen } : { numeric: Number(numeric) },
      note: note.trim() || undefined,
    };
    const parsed = mapPendingBodySchema.safeParse(candidate);
    if (!parsed.success) {
      map.reset();
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join('.')] = issue.message;
      setLocal(next);
      return;
    }
    setLocal({});
    map.mutate(parsed.data);
  }

  // `value.levelId` is the API's path (it resolves the levels one by one);
  // `value.levelIds` the shared schema's (the array as a whole).
  const valueError =
    errors['value.levelId'] ?? errors['value.levelIds'] ?? errors['value.numeric'] ?? errors.value;
  return (
    <Dialog open title={`Map "${group.valueText}"`} onClose={onClose} closeDisabled={map.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-meta text-mist-500">
          {humaniseKey(trait.key)} · {group.count} {group.count === 1 ? 'record' : 'records'} ·{' '}
          {group.harmonisation.replace('_', ' ')}
        </p>
        {errors.traitId ? <p className="text-label text-red-700">{errors.traitId}</p> : null}
        {trait.valueType === 'categorical' ? (
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={valueError ? `${ids.numeric}-error` : undefined}
          >
            <legend className="text-label font-bold uppercase tracking-[0.08em] text-canopy-800">
              Levels
            </legend>
            {levelsError ? (
              <p className="text-meta text-red-700">Could not load the levels. Reload the page.</p>
            ) : active === undefined ? (
              <p className="text-meta text-mist-500">Loading levels…</p>
            ) : null}
            {(active ?? []).map((level) => (
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
            {active?.length === 0 ? (
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
          <Button type="submit" pending={map.isPending} disabled={!levelsReady || levelsError}>
            Map records
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
