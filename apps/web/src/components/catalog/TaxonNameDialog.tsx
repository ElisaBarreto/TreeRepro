import { useMutation, useQueryClient } from '@tanstack/react-query';
import { catalogNameSchema } from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { invalidateAfterCatalogWrite } from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { fieldErrors } from '../../lib/errors.ts';
import { Alert, Button, Dialog, Field, Input } from '../ui/index.ts';
import { taxonErrorMessage } from './errors.ts';

function isNameTaken(error: unknown): boolean {
  return error instanceof ApiError && error.code.endsWith('_NAME_TAKEN');
}

/**
 * One name form for the four taxon writes of RFC-60 R9 (new family, rename
 * family, new genus, rename genus): the caller binds the title, the label,
 * the initial value, the submit label, the 409 sentence and the `save` call.
 * The name is trimmed and checked with the shared schema before sending; a
 * rename that leaves the name as it was closes without a request. Mounted
 * only while open, so its state starts fresh each time.
 * @rfc RFC-13 R6
 * @rfc RFC-60 R9
 */
export function TaxonNameDialog({
  title,
  label,
  initial,
  submitLabel,
  takenMessage,
  save,
  onClose,
  onSaved,
}: {
  title: string;
  label: string;
  /** The current name of a rename; absent on a create. */
  initial?: string;
  submitLabel: string;
  /** The sentence for the `*_NAME_TAKEN` answer. */
  takenMessage: string;
  save: (name: string) => Promise<unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const [name, setName] = useState(initial ?? '');
  const [local, setLocal] = useState<string | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: (next: string) => save(next),
    onSuccess: async () => {
      await invalidateAfterCatalogWrite(queryClient, 'taxa');
      onSaved();
    },
  });
  const fieldError =
    local ??
    (isNameTaken(mutation.error) ? takenMessage : undefined) ??
    fieldErrors(mutation.error).name;
  const formError =
    mutation.isError && fieldError === undefined ? taxonErrorMessage(mutation.error) : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = catalogNameSchema.safeParse(name);
    if (!parsed.success) {
      mutation.reset();
      setLocal(name.trim() === '' ? 'Enter a name.' : parsed.error.issues[0]?.message);
      return;
    }
    if (initial !== undefined && parsed.data === initial) {
      onClose();
      return;
    }
    setLocal(undefined);
    mutation.mutate(parsed.data);
  }

  return (
    <Dialog open title={title} onClose={onClose} closeDisabled={mutation.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id={id} label={label} error={fieldError}>
          <Input
            id={id}
            value={name}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            invalid={Boolean(fieldError)}
          />
        </Field>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
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
