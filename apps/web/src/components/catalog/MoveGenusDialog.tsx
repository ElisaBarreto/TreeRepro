import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Genus, TaxonRef } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { invalidateAfterCatalogWrite, updateGenus } from '../../api/catalog.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Select } from '../ui/index.ts';
import { taxonErrorMessage } from './errors.ts';

/**
 * Moves a genus to another family, or to none ("No family" sends
 * `familyId: null`, RFC-60 R9). The select starts on the genus's current
 * family; leaving it there closes without a request. Mounted only while
 * open.
 * @rfc RFC-13 R6
 * @rfc RFC-60 R9
 */
export function MoveGenusDialog({
  genus,
  families,
  onClose,
  onSaved,
}: {
  genus: Genus;
  families: TaxonRef[];
  onClose: () => void;
  /** Receives the genus as the API answered it after the move. */
  onSaved: (genus: Genus) => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const current = genus.family?.id ?? '';
  const [familyId, setFamilyId] = useState(current);
  const mutation = useMutation({
    mutationFn: (next: string | null) => updateGenus(genus.id, { familyId: next }),
    onSuccess: async (saved) => {
      await invalidateAfterCatalogWrite(queryClient, 'taxa');
      onSaved(saved);
    },
  });
  const fieldError = fieldErrors(mutation.error).familyId;
  const formError =
    mutation.isError && fieldError === undefined ? taxonErrorMessage(mutation.error) : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (familyId === current) {
      onClose();
      return;
    }
    mutation.mutate(familyId || null);
  }

  return (
    <Dialog open title={`Move ${genus.name}`} onClose={onClose} closeDisabled={mutation.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id={id} label="Family" error={fieldError}>
          <Select
            id={id}
            value={familyId}
            onChange={(event) => setFamilyId(event.target.value)}
            invalid={Boolean(fieldError)}
          >
            <option value="">No family</option>
            {families.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name}
              </option>
            ))}
          </Select>
        </Field>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={mutation.isPending}>
            Move
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
