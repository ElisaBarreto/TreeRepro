import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CreateTraitBody,
  createTraitBodySchema,
  TRAIT_VALUE_TYPES,
  type Trait,
  type TraitValueType,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { createTrait, invalidateAfterCatalogWrite } from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, pageErrorMessage } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function traitErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'TRAIT_KEY_TAKEN':
        return 'A trait with this key already exists.';
      case 'TRAIT_NOT_FOUND':
        return 'This trait no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

const LOCAL: Record<string, string> = { key: 'Enter a key.', categoryKey: 'Choose a category.' };

/**
 * The form of RFC-62 R6 `POST /api/traits`: key, category (one of the
 * dictionary's), value type, unit and description — the last two optional.
 * Key, value type and unit are immutable afterwards (the hint says so).
 * Mounted only while open.
 * @rfc RFC-13 R6
 * @rfc RFC-62 R6
 */
export function NewTraitDialog({
  categories,
  onClose,
  onSaved,
}: {
  categories: ReadonlyArray<{ key: string; label: string }>;
  onClose: () => void;
  onSaved: (trait: Trait) => void;
}) {
  const queryClient = useQueryClient();
  const ids = {
    key: useId(),
    category: useId(),
    type: useId(),
    unit: useId(),
    description: useId(),
  };
  const [key, setKey] = useState('');
  const [categoryKey, setCategoryKey] = useState('');
  const [valueType, setValueType] = useState<TraitValueType>('categorical');
  const [unit, setUnit] = useState('');
  const [description, setDescription] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: CreateTraitBody) => createTrait(body),
    onSuccess: async (trait) => {
      await invalidateAfterCatalogWrite(queryClient, 'traits');
      onSaved(trait);
    },
  });
  // Annotated: TS otherwise collapses the merge of two `Record<string, string>`
  // spreads around a conditional `{ key } | {}` one into just `{ key?: string }`,
  // dropping every other field's index signature.
  const errors: Record<string, string> = {
    ...fieldErrors(save.error),
    ...(save.error instanceof ApiError && save.error.code === 'TRAIT_KEY_TAKEN'
      ? { key: traitErrorMessage(save.error) }
      : {}),
    ...local,
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const required: Record<string, string> = {};
    if (key.trim() === '') required.key = LOCAL.key ?? '';
    if (categoryKey === '') required.categoryKey = LOCAL.categoryKey ?? '';
    if (Object.keys(required).length > 0) {
      save.reset();
      setLocal(required);
      return;
    }
    const parsed = createTraitBodySchema.safeParse({
      key: key.trim(),
      categoryKey,
      valueType,
      unit: unit.trim() || undefined,
      description: description.trim() || undefined,
    });
    if (!parsed.success) {
      save.reset();
      setLocal(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setLocal({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog open title="New trait" onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          id={ids.key}
          label="Key"
          hint="snake_case, immutable once created (the import matches by key)."
          error={errors.key}
        >
          <Input
            id={ids.key}
            value={key}
            maxLength={200}
            onChange={(e) => setKey(e.target.value)}
            invalid={Boolean(errors.key)}
          />
        </Field>
        <Field id={ids.category} label="Category" error={errors.categoryKey}>
          <Select
            id={ids.category}
            value={categoryKey}
            onChange={(e) => setCategoryKey(e.target.value)}
            invalid={Boolean(errors.categoryKey)}
          >
            <option value="">Choose a category</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={ids.type}
          label="Value type"
          hint="Immutable once created."
          error={errors.valueType}
        >
          <Select
            id={ids.type}
            value={valueType}
            onChange={(e) => setValueType(e.target.value as TraitValueType)}
          >
            {TRAIT_VALUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id={ids.unit}
          label="Unit (optional)"
          hint="Immutable once created; a changed unit would change the meaning of stored numbers."
          error={errors.unit}
        >
          <Input
            id={ids.unit}
            value={unit}
            maxLength={32}
            onChange={(e) => setUnit(e.target.value)}
            invalid={Boolean(errors.unit)}
          />
        </Field>
        <Field id={ids.description} label="Description (optional)" error={errors.description}>
          <Textarea
            id={ids.description}
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {save.isError && !errors.key ? (
          <Alert tone="error">{traitErrorMessage(save.error)}</Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            Create trait
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
