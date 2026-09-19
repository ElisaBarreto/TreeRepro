import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type CreateProposalBody,
  createProposalBodySchema,
  type Proposal,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { createProposal, invalidateAfterProposalWrite } from '../../api/proposals.ts';
import { fieldErrors, isValidationError } from '../../lib/errors.ts';
import { proposeErrorMessage, takenSpeciesId } from '../curation/proposal-errors.ts';
import { Alert, Button, Dialog, Field, Input, Textarea } from '../ui/index.ts';

const LOCAL_MESSAGES: Record<string, string> = {
  name: 'Enter at least three characters of the species name.',
};

/**
 * The contributor's side of RFC-75: a name — prefilled with the search term
 * that found nothing — and an optional note saying where it was seen. The
 * API owns every rule; the schema is parsed here only so a name too short to
 * be sent is refused without a round trip (RFC-13 R1, R6).
 *
 * Its two 409s are what the dialog exists to explain. `SPECIES_NAME_TAKEN`
 * carries the species id in `details[0].message` (RFC-75 R2) — the proposer
 * was looking for exactly that species and could not find it, so the sentence
 * links straight to it. `PROPOSAL_EXISTS` means somebody got there first and
 * the queue already holds the name.
 * @rfc RFC-13 R5, R6
 * @rfc RFC-75 R2
 */
export function ProposeSpeciesDialog({
  name: initialName,
  onClose,
  onProposed,
}: {
  name: string;
  onClose: () => void;
  onProposed: (proposal: Proposal) => void;
}) {
  const queryClient = useQueryClient();
  const ids = { name: useId(), note: useId() };
  const [name, setName] = useState(initialName);
  const [note, setNote] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});

  const propose = useMutation({
    mutationFn: (body: CreateProposalBody) => createProposal(body),
    onSuccess: async (proposal) => {
      await invalidateAfterProposalWrite(queryClient);
      onProposed(proposal);
    },
  });

  const errors: Record<string, string> = { ...fieldErrors(propose.error), ...local };
  const speciesId = takenSpeciesId(propose.error);
  const conflict =
    propose.error instanceof ApiError &&
    (propose.error.code === 'SPECIES_NAME_TAKEN' || propose.error.code === 'PROPOSAL_EXISTS');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNote = note.trim();
    const parsed = createProposalBodySchema.safeParse({
      name: name.trim(),
      ...(trimmedNote === '' ? {} : { note: trimmedNote }),
    });
    if (!parsed.success) {
      propose.reset();
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        next[path] = LOCAL_MESSAGES[path] ?? issue.message;
      }
      setLocal(next);
      return;
    }
    setLocal({});
    propose.mutate(parsed.data);
  }

  return (
    <Dialog open title="Propose a species" onClose={onClose} closeDisabled={propose.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          id={ids.name}
          label="Species name"
          hint="The name as you know it. A reviewer checks it against GBIF before deciding."
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
        <Field
          id={ids.note}
          label="Note (optional)"
          hint="Where you saw it, the authority, anything the reviewer should know."
          error={errors.note}
        >
          <Textarea
            id={ids.note}
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            invalid={Boolean(errors.note)}
          />
        </Field>
        {conflict ? (
          <Alert tone="error">
            {speciesId === null ? (
              proposeErrorMessage(propose.error)
            ) : (
              <>
                {'This species exists — '}
                <Link
                  to="/app/species/$id"
                  params={{ id: speciesId }}
                  className="font-semibold underline"
                >
                  open it
                </Link>
                .
              </>
            )}
          </Alert>
        ) : null}
        {propose.isError && !conflict && !isValidationError(propose.error) ? (
          <Alert tone="error">{proposeErrorMessage(propose.error)}</Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={propose.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={propose.isPending}>
            Propose
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
