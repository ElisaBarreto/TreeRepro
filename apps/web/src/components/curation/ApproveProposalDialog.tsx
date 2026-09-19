import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type ApproveProposalBody,
  approveProposalBodySchema,
  type NameSource,
  type Proposal,
} from '@treerepro/contracts';
import { type FormEvent, useId, useState } from 'react';
import { invalidateAfterCatalogWrite } from '../../api/catalog.ts';
import { ApiError } from '../../api/client.ts';
import { approveProposal, invalidateAfterProposalWrite } from '../../api/proposals.ts';
import { fieldErrors, isValidationError } from '../../lib/errors.ts';
import { SpeciesNameFields } from '../catalog/SpeciesNameFields.tsx';
import { Alert, Button, Dialog, Field, Input } from '../ui/index.ts';
import { decideErrorMessage } from './proposal-errors.ts';
import { proposalPrefill } from './proposal-prefill.ts';

const LOCAL_MESSAGES: Record<string, string> = { canonicalName: 'Enter the canonical name.' };

/**
 * The approval form of RFC-75 R4: the species a proposal becomes, opened on
 * the prefill its stored lookup produces (`proposalPrefill`) and saved
 * through `POST /api/species/proposals/:id/approve`, which creates the
 * species and decides the proposal in one transaction.
 *
 * It is a sibling of `SpeciesDialog` rather than a mode of it, because only
 * the canonical name and its source are shared — those live in
 * `SpeciesNameFields`. The genus and family here are **names**: the approve
 * endpoint resolves them and creates the taxa when they are missing, so
 * there is no id to look up and nothing to create separately first, which is
 * what the catalog form's family select and genus combobox exist to do.
 *
 * Its 409 `SPECIES_NAME_TAKEN` is not the proposer's. The pre-check of
 * RFC-75 R2 is scoped to what the proposer can see, while the unique index
 * this route hits is global, so a plot-restricted contributor can have a
 * name accepted into the queue that a species outside their plots already
 * holds. The API cannot name that species — the answer carries no id, by
 * design — so the sentence says what happened and offers a catalog search
 * for the name instead of a bare conflict.
 * @rfc RFC-13 R5, R6, R10
 * @rfc RFC-75 R4
 */
export function ApproveProposalDialog({
  proposal,
  onClose,
  onApproved,
}: {
  proposal: Proposal;
  onClose: () => void;
  onApproved: (proposal: Proposal) => void;
}) {
  const queryClient = useQueryClient();
  const ids = { family: useId(), genus: useId() };
  const [prefill] = useState(() => proposalPrefill(proposal));
  const [canonicalName, setCanonicalName] = useState(prefill.canonicalName);
  const [nameSource, setNameSource] = useState<NameSource>(prefill.nameSource);
  const [genusName, setGenusName] = useState(prefill.genusName);
  const [familyName, setFamilyName] = useState(prefill.familyName);
  const [local, setLocal] = useState<Record<string, string>>({});

  const approve = useMutation({
    mutationFn: (body: ApproveProposalBody) => approveProposal(proposal.id, body),
    onSuccess: async (decided) => {
      // An approval creates a species and decides a proposal at once, so
      // both the catalog lists and the two proposal lists are stale.
      await invalidateAfterCatalogWrite(queryClient, 'taxa');
      await invalidateAfterProposalWrite(queryClient);
      onApproved(decided);
    },
  });

  const errors: Record<string, string> = { ...fieldErrors(approve.error), ...local };
  const nameTaken =
    approve.error instanceof ApiError && approve.error.code === 'SPECIES_NAME_TAKEN';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = approveProposalBodySchema.safeParse({
      canonicalName: canonicalName.trim(),
      nameSource,
      ...(genusName.trim() === '' ? {} : { genusName: genusName.trim() }),
      ...(familyName.trim() === '' ? {} : { familyName: familyName.trim() }),
    });
    if (!parsed.success) {
      approve.reset();
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        next[path] = LOCAL_MESSAGES[path] ?? issue.message;
      }
      setLocal(next);
      return;
    }
    setLocal({});
    approve.mutate(parsed.data);
  }

  return (
    <Dialog open title="Approve proposal" onClose={onClose} closeDisabled={approve.isPending}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <SpeciesNameFields
          canonicalName={canonicalName}
          onCanonicalNameChange={setCanonicalName}
          nameSource={nameSource}
          onNameSourceChange={setNameSource}
          errors={{ canonicalName: errors.canonicalName, nameSource: errors.nameSource }}
        />
        <Field
          id={ids.family}
          label="Family"
          hint="Created when the catalog does not have it yet."
          error={errors.familyName}
        >
          <Input
            id={ids.family}
            value={familyName}
            maxLength={200}
            onChange={(e) => setFamilyName(e.target.value)}
            invalid={Boolean(errors.familyName)}
          />
        </Field>
        <Field
          id={ids.genus}
          label="Genus"
          hint="Created when the catalog does not have it yet."
          error={errors.genusName}
        >
          <Input
            id={ids.genus}
            value={genusName}
            maxLength={200}
            onChange={(e) => setGenusName(e.target.value)}
            invalid={Boolean(errors.genusName)}
          />
        </Field>
        {approve.isError && !isValidationError(approve.error) ? (
          <Alert tone="error">
            {decideErrorMessage(approve.error)}
            {nameTaken ? (
              <>
                {' '}
                <Link
                  to="/app/species"
                  search={{ q: proposal.proposedName }}
                  className="font-semibold underline"
                >
                  Search the catalog for this name
                </Link>
                .
              </>
            ) : null}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={approve.isPending}>
            Cancel
          </Button>
          <Button type="submit" pending={approve.isPending}>
            Approve and create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
