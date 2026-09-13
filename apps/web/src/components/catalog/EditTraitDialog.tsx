import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Trait, type UpdateTraitBody, updateTraitBodySchema } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { invalidateAfterCatalogWrite, updateTrait } from '../../api/catalog.ts';
import { fieldErrors, isValidationError } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Select, Textarea } from '../ui/index.ts';
import { traitErrorMessage } from './NewTraitDialog.tsx';

/**
 * The form of RFC-62 R6 `PATCH /api/traits/:id`: key, value type and unit
 * are immutable, so they render as text; only category, description and
 * active are editable. Sends only what changed; an unchanged form closes
 * without a request. Mounted only while open.
 * @rfc RFC-13 R6
 * @rfc RFC-62 R6
 */
export function EditTraitDialog({
  trait,
  categoryKey,
  categories,
  onClose,
  onSaved,
}: {
  trait: Trait;
  categoryKey: string;
  categories: ReadonlyArray<{ key: string; label: string }>;
  onClose: () => void;
  onSaved: (trait: Trait) => void;
}) {
  const queryClient = useQueryClient();
  const ids = { category: useId(), description: useId() };
  const [category, setCategory] = useState(categoryKey);
  const [description, setDescription] = useState(trait.description);
  const [active, setActive] = useState(trait.active);
  const [local, setLocal] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: UpdateTraitBody) => updateTrait(trait.id, body),
    onSuccess: async (updated) => {
      await invalidateAfterCatalogWrite(queryClient, 'traits');
      onSaved(updated);
    },
  });
  const errors = { ...fieldErrors(save.error), ...local };

  /** The fields that changed since the trait was loaded, or `null` for none. */
  function diff(): UpdateTraitBody | null {
    const body: UpdateTraitBody = {};
    if (category !== categoryKey) body.categoryKey = category;
    if (description.trim() !== trait.description) body.description = description.trim();
    if (active !== trait.active) body.active = active;
    return Object.keys(body).length > 0 ? body : null;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = diff();
    if (!body) {
      onClose();
      return;
    }
    const parsed = updateTraitBodySchema.safeParse(body);
    if (!parsed.success) {
      save.reset();
      setLocal(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setLocal({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog open title="Edit trait" onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-body text-canopy-900">
          <span className="text-mist-500">Key: </span>
          {trait.key}
          <span className="text-mist-500">
            {' '}
            · {trait.valueType}
            {trait.unit ? ` · ${trait.unit}` : ''}
          </span>
        </p>
        <Field id={ids.category} label="Category" error={errors.categoryKey}>
          <Select
            id={ids.category}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            invalid={Boolean(errors.categoryKey)}
          >
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={ids.description} label="Description (optional)" error={errors.description}>
          <Textarea
            id={ids.description}
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            className="size-4 accent-canopy-600"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active — inactive traits are hidden from manual entry; their records stay
        </label>
        {save.isError && !isValidationError(save.error) ? (
          <Alert tone="error">{traitErrorMessage(save.error)}</Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
