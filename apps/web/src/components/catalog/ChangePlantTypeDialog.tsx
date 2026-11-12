import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PLANT_TYPE_LABELS, PLANT_TYPES, type PlantType, type Species } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { changePlantType, invalidateAfterCatalogWrite } from '../../api/catalog.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Select } from '../ui/index.ts';

/**
 * Sets a species' plant type and marks it reviewed (RFC-65 R19): the current
 * type preselected, so saving it unchanged confirms a proposed type.
 * Mounted only while open.
 * @rfc RFC-65 R19
 */
export function ChangePlantTypeDialog({
  species,
  onClose,
  onSaved,
}: {
  species: Species;
  onClose: () => void;
  onSaved: (species: Species) => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const [plantType, setPlantType] = useState<PlantType>(species.plantType);
  const save = useMutation({
    mutationFn: (next: PlantType) => changePlantType(species.id, next),
    onSuccess: async (saved) => {
      await invalidateAfterCatalogWrite(queryClient, 'taxa');
      onSaved(saved);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(plantType);
  }

  return (
    <Dialog open title="Change plant type" onClose={onClose} closeDisabled={save.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
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
        {save.isError ? <Alert tone="error">{pageErrorMessage(save.error)}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={save.isPending}>
            Save and mark reviewed
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
