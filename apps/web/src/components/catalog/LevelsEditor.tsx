import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLevelBodySchema, type Trait, type TraitLevel } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { createLevel, invalidateAfterCatalogWrite, updateLevel } from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, isValidationError } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';
import { Alert, Badge, Button, Dialog, Field, Input } from '../ui/index.ts';
import { levelErrorMessage } from './errors.ts';

/**
 * The single-field form behind Add level / Rename level: a rename prefills
 * `initial` and shows the seed CSV warning (RFC-62 R6 — `seed:traits`
 * re-inserts a level under its old key unless the CSV is renamed too).
 * `LEVEL_KEY_TAKEN` lands under the Key field, same as a `VALIDATION_FAILED`
 * detail; anything else that fails the request shows as a page-level Alert.
 * Mounted only while open.
 * @rfc RFC-13 R6
 * @rfc RFC-62 R6
 */
function LevelKeyDialog({
  title,
  submitLabel,
  initial,
  warning = false,
  save,
  onClose,
  onSaved,
}: {
  title: string;
  submitLabel: string;
  /** The level's current key on a rename; absent on Add level. */
  initial?: string;
  warning?: boolean;
  save: (key: string) => Promise<Trait>;
  onClose: () => void;
  onSaved: (trait: Trait) => void;
}) {
  const queryClient = useQueryClient();
  const keyId = useId();
  const [key, setKey] = useState(initial ?? '');
  const [local, setLocal] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (value: string) => save(value),
    onSuccess: async (trait) => {
      await invalidateAfterCatalogWrite(queryClient, 'traits');
      onSaved(trait);
    },
  });
  const errors: Record<string, string> = {
    ...fieldErrors(mutation.error),
    ...(mutation.error instanceof ApiError && mutation.error.code === 'LEVEL_KEY_TAKEN'
      ? { key: levelErrorMessage(mutation.error) }
      : {}),
    ...local,
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createLevelBodySchema.pick({ key: true }).safeParse({ key: key.trim() });
    if (!parsed.success) {
      mutation.reset();
      setLocal(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    if (initial !== undefined && parsed.data.key === initial) {
      onClose();
      return;
    }
    setLocal({});
    mutation.mutate(parsed.data.key);
  }

  return (
    <Dialog open title={title} onClose={onClose} closeDisabled={mutation.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {warning ? (
          <Alert tone="info">
            The repository's <code>trait-dictionary.csv</code> is the source of the vocabulary:{' '}
            <code>seed:traits</code> re-inserts a level under its old key unless the CSV is renamed
            too.
          </Alert>
        ) : null}
        <Field id={keyId} label="Key" error={errors.key}>
          <Input
            id={keyId}
            value={key}
            maxLength={200}
            onChange={(e) => setKey(e.target.value)}
            invalid={Boolean(errors.key)}
          />
        </Field>
        {mutation.isError && !isValidationError(mutation.error) && !errors.key ? (
          <Alert tone="error">{levelErrorMessage(mutation.error)}</Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={mutation.isPending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The levels of one trait, in the order the API gives them (`sortOrder,
 * key` — never re-sorted client-side). A reader sees the list only; with
 * `canManage` each level gets Rename, Move up/down (disabled at the ends)
 * and Deactivate/Activate, and the list gets an Add level action. Every
 * mutation answers the whole parent trait and invalidates the dictionary
 * (RFC-13 R6) — this component never keeps that answer, the page re-renders
 * from the refetched dictionary. A move swaps the `sortOrder` of the moved
 * level and its neighbour in one `mutationFn`, moved level first, unless
 * the two are already equal (only possible in a dictionary seeded before
 * `sortOrder` existed), in which case a single patch shifts the moved
 * level's `sortOrder` past the neighbour's — except moving up across a tie
 * at 0, where the moved level cannot go negative, so the neighbour is
 * patched down past it instead.
 * @rfc RFC-62 R6
 * @rfc RFC-13 R3, R6
 */
export function LevelsEditor({ trait, canManage }: { trait: Trait; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<TraitLevel | null>(null);
  const toggle = useMutation({
    mutationFn: (input: { levelId: string; active: boolean }) =>
      updateLevel(trait.id, input.levelId, { active: input.active }),
    onSuccess: () => invalidateAfterCatalogWrite(queryClient, 'traits'),
  });
  const move = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: 'up' | 'down' }) => {
      const level = trait.levels[index];
      const neighbour = trait.levels[direction === 'down' ? index + 1 : index - 1];
      if (!level || !neighbour) return;
      if (level.sortOrder === neighbour.sortOrder) {
        if (direction === 'down') {
          await updateLevel(trait.id, level.id, { sortOrder: neighbour.sortOrder + 1 });
        } else if (neighbour.sortOrder > 0) {
          await updateLevel(trait.id, level.id, { sortOrder: neighbour.sortOrder - 1 });
        } else {
          // The moved level cannot go below 0, so the neighbour moves down instead.
          await updateLevel(trait.id, neighbour.id, { sortOrder: level.sortOrder + 1 });
        }
        return;
      }
      await updateLevel(trait.id, level.id, { sortOrder: neighbour.sortOrder });
      await updateLevel(trait.id, neighbour.id, { sortOrder: level.sortOrder });
    },
    // A partial swap (the moved level's PATCH lands, the neighbour's fails)
    // is still a write: onSettled refetches even on failure, so the tie it
    // leaves behind (docs/gotchas/web.md) is visible in the list right away
    // instead of waiting for an unrelated refetch.
    onSettled: () => invalidateAfterCatalogWrite(queryClient, 'traits'),
  });
  const listError = toggle.isError ? toggle.error : move.isError ? move.error : undefined;

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={`Levels of ${humaniseKey(trait.key)}`} className="flex flex-col gap-1.5">
        {trait.levels.map((level, index) => (
          <li key={level.id} className="flex flex-wrap items-center gap-2">
            {level.active ? (
              <Badge>{level.key}</Badge>
            ) : (
              <Badge>
                <span className="line-through">{level.key}</span>
                <span className="sr-only"> (inactive)</span>
              </Badge>
            )}
            {canManage ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Rename ${level.key}`}
                  disabled={move.isPending || toggle.isPending}
                  onClick={() => setRenaming(level)}
                >
                  Rename
                </Button>
                {/* The visible text stays a prefix of the accessible name
                    (WCAG 2.5.3 label-in-name): the level key follows it
                    for assistive technology instead of an aria-label that
                    interleaves it. */}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={index === 0 || move.isPending || toggle.isPending}
                  onClick={() => move.mutate({ index, direction: 'up' })}
                >
                  Move up <span className="sr-only">{level.key}</span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={index === trait.levels.length - 1 || move.isPending || toggle.isPending}
                  onClick={() => move.mutate({ index, direction: 'down' })}
                >
                  Move down <span className="sr-only">{level.key}</span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${level.active ? 'Deactivate' : 'Activate'} ${level.key}`}
                  disabled={move.isPending || toggle.isPending}
                  onClick={() => toggle.mutate({ levelId: level.id, active: !level.active })}
                >
                  {level.active ? 'Deactivate' : 'Activate'}
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <Button size="sm" className="self-start" onClick={() => setAdding(true)}>
          Add level
        </Button>
      ) : null}
      {canManage && listError !== undefined && !isValidationError(listError) ? (
        <Alert tone="error">{levelErrorMessage(listError)}</Alert>
      ) : null}
      {adding ? (
        <LevelKeyDialog
          title="Add level"
          submitLabel="Add level"
          save={(key) => createLevel(trait.id, { key })}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
        />
      ) : null}
      {renaming ? (
        <LevelKeyDialog
          title="Rename level"
          submitLabel="Rename"
          initial={renaming.key}
          warning
          save={(key) => updateLevel(trait.id, renaming.id, { key })}
          onClose={() => setRenaming(null)}
          onSaved={() => setRenaming(null)}
        />
      ) : null}
    </div>
  );
}
