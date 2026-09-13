import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Species, type SpeciesNameBody, speciesNameBodySchema } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { addSpeciesName, invalidateAfterCatalogWrite } from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors, pageErrorMessage } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Input } from '../ui/index.ts';

/** @rfc RFC-13 R6 */
export function addNameErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SPECIES_NAME_TAKEN':
        return 'This species already has that name.';
      case 'SPECIES_NOT_FOUND':
        return 'This species no longer exists. Reload the page.';
      case 'VALIDATION_FAILED':
        return 'Check the highlighted fields.';
    }
  }
  return pageErrorMessage(error);
}

const LOCAL_MESSAGES: Record<string, string> = { name: 'Enter the name.' };

/**
 * Adds an alternative name to a species (RFC-60 R9): the name and an
 * optional GBIF usage key; the API stores it as a GBIF-sourced name. A name
 * the species already carries lands under the field. Mounted only while open.
 * @rfc RFC-13 R6
 * @rfc RFC-60 R9
 */
export function AddNameDialog({
  species,
  onClose,
  onSaved,
}: {
  species: Species;
  onClose: () => void;
  onSaved: (species: Species) => void;
}) {
  const queryClient = useQueryClient();
  const ids = { name: useId(), key: useId() };
  const [name, setName] = useState('');
  const [gbifUsageKey, setGbifUsageKey] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: SpeciesNameBody) => addSpeciesName(species.id, body),
    onSuccess: async (saved) => {
      await invalidateAfterCatalogWrite(queryClient, 'taxa');
      onSaved(saved);
    },
  });
  // A name the species already carries is the name field's own error, not the form's.
  const nameTaken = save.error instanceof ApiError && save.error.code === 'SPECIES_NAME_TAKEN';
  const errors: Record<string, string> = { ...fieldErrors(save.error), ...local };
  if (nameTaken) errors.name = addNameErrorMessage(save.error);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = gbifUsageKey.trim();
    const parsed = speciesNameBodySchema.safeParse({
      name: name.trim(),
      ...(key === '' ? {} : { gbifUsageKey: key }),
    });
    if (!parsed.success) {
      save.reset();
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        next[path] = LOCAL_MESSAGES[path] ?? issue.message;
      }
      setLocal(next);
      return;
    }
    setLocal({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog open title="Add alternative name" onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          id={ids.name}
          label="Name"
          hint="The name is stored as a GBIF-sourced alternative name."
          error={errors.name}
        >
          <Input
            id={ids.name}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            invalid={Boolean(errors.name)}
          />
        </Field>
        <Field id={ids.key} label="GBIF usage key (optional)" error={errors.gbifUsageKey}>
          <Input
            id={ids.key}
            value={gbifUsageKey}
            maxLength={64}
            onChange={(e) => setGbifUsageKey(e.target.value)}
            invalid={Boolean(errors.gbifUsageKey)}
          />
        </Field>
        {save.isError && !nameTaken ? (
          <Alert tone="error">{addNameErrorMessage(save.error)}</Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            Add name
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
