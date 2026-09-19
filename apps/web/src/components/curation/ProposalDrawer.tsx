import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Proposal, ProposalStatus } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { invalidateAfterProposalWrite, rejectProposal } from '../../api/proposals.ts';
import { isoDate } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { SpeciesDialog } from '../catalog/SpeciesDialog.tsx';
import { DrawerSection } from '../dataset/DrawerSection.tsx';
import { Alert, Badge, Button, Drawer, Field, Textarea } from '../ui/index.ts';
import { LookupBadge, LookupCard } from './LookupCard.tsx';
import { decideErrorMessage } from './proposal-errors.ts';
import { proposalPrefill } from './proposal-prefill.ts';

/** How each proposal status reads and looks. @rfc RFC-75 R6 */
const STATUS_TONES: Record<ProposalStatus, 'amber' | 'green' | 'red'> = {
  open: 'amber',
  approved: 'green',
  rejected: 'red',
};

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-body text-canopy-900">
      <span className="text-mist-500">{`${label}: `}</span>
      {children}
    </p>
  );
}

/**
 * One proposal in full (RFC-75 R6): who proposed the name and when, the note
 * they left, the verdict the lookup reached and one card per source.
 *
 * The verdict is the API's, rendered as it stands. A `lookup` of `null` is
 * the `failed` case of RFC-81 R3 — the call did not complete — and says so
 * plainly, because telling a proposer their species was "not found" when
 * nobody actually checked is a different, and false, statement.
 *
 * With `taxa.manage` an open proposal offers the two decisions of RFC-75 R4:
 * **Approve** opens the species dialog prefilled from the match and its save
 * is the approve endpoint, **Reject** asks for the note the decision is
 * recorded with. A decided proposal shows the decision instead and offers
 * neither, whatever the viewer holds.
 * @rfc RFC-13 R3, R5, R10
 * @rfc RFC-75 R4, R6
 * @rfc RFC-81 R3
 */
export function ProposalDrawer({
  proposal,
  onClose,
  onDecided,
}: {
  proposal: Proposal | null;
  onClose: () => void;
  onDecided: (proposal: Proposal) => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>(undefined);
  const [approving, setApproving] = useState(false);

  const reject = useMutation({
    mutationFn: (input: { id: string; note: string }) =>
      rejectProposal(input.id, { note: input.note }),
    onSuccess: async (decided) => {
      await invalidateAfterProposalWrite(queryClient);
      onDecided(decided);
    },
  });

  if (!proposal) return null;
  const canDecide = hasPermission(me, 'taxa.manage') && proposal.status === 'open';
  const lookup = proposal.lookup;

  function submitRejection() {
    if (!proposal || reject.isPending) return;
    const trimmed = note.trim();
    if (trimmed === '') {
      reject.reset();
      setNoteError('Say why it is rejected.');
      return;
    }
    setNoteError(undefined);
    reject.mutate({ id: proposal.id, note: trimmed });
  }

  return (
    <>
      <Drawer open title="Proposal" onClose={onClose}>
        <div className="flex flex-col gap-6">
          <DrawerSection title="Proposed">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-section font-semibold text-canopy-950">
                {proposal.proposedName}
              </h3>
              <Badge tone={STATUS_TONES[proposal.status]}>{proposal.status}</Badge>
            </div>
            <Line label="Proposer">{proposal.proposer.name}</Line>
            <Line label="Proposed on">{isoDate(proposal.createdAt)}</Line>
            {proposal.note ? <p className="text-body text-canopy-900">{proposal.note}</p> : null}
          </DrawerSection>

          <DrawerSection title="Taxonomy lookup">
            <div className="flex items-center gap-2">
              <LookupBadge lookup={lookup} />
              {proposal.lookupAt ? (
                <span className="text-meta text-mist-500">{isoDate(proposal.lookupAt)}</span>
              ) : null}
            </div>
            {lookup === null ? (
              <p className="text-body text-mist-500">
                The lookup could not be completed, so nothing was checked against GBIF. This says
                nothing about the name.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <LookupCard source="GBIF backbone" match={lookup.backbone} />
                <LookupCard source="WCVP" match={lookup.wcvp} />
              </div>
            )}
          </DrawerSection>

          {proposal.status === 'open' ? null : (
            <DrawerSection title="Decision">
              {proposal.decidedBy ? (
                <Line label="Decided by">{proposal.decidedBy.name}</Line>
              ) : null}
              {proposal.decidedAt ? (
                <Line label="Decided on">{isoDate(proposal.decidedAt)}</Line>
              ) : null}
              {proposal.species ? (
                <Line label="Species">
                  <Link
                    to="/app/species/$id"
                    params={{ id: proposal.species.id }}
                    className="font-semibold underline"
                  >
                    {proposal.species.canonicalName}
                  </Link>
                </Line>
              ) : null}
              {proposal.decisionNote ? (
                <p className="text-body text-canopy-900">{proposal.decisionNote}</p>
              ) : null}
            </DrawerSection>
          )}

          {canDecide ? (
            <DrawerSection title="Decide">
              {rejecting ? (
                <Field id={noteId} label="Why is it rejected?" error={noteError}>
                  <Textarea
                    id={noteId}
                    value={note}
                    maxLength={2000}
                    onChange={(e) => setNote(e.target.value)}
                    invalid={Boolean(noteError)}
                  />
                </Field>
              ) : null}
              {reject.isError ? (
                <Alert tone="error">{decideErrorMessage(reject.error)}</Alert>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {rejecting ? (
                  <>
                    <Button pending={reject.isPending} onClick={submitRejection}>
                      Reject proposal
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={reject.isPending}
                      onClick={() => {
                        setRejecting(false);
                        setNoteError(undefined);
                        reject.reset();
                      }}
                    >
                      Keep it open
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={() => setApproving(true)}>Approve</Button>
                    <Button variant="secondary" onClick={() => setRejecting(true)}>
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </DrawerSection>
          ) : null}
        </div>
      </Drawer>
      {approving ? (
        <SpeciesDialog
          approval={{
            proposalId: proposal.id,
            proposedName: proposal.proposedName,
            ...proposalPrefill(proposal),
            onApproved: (decided) => {
              setApproving(false);
              onDecided(decided);
            },
          }}
          onClose={() => setApproving(false)}
        />
      ) : null}
    </>
  );
}
