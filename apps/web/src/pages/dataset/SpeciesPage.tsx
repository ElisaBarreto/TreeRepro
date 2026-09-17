import { useQuery } from '@tanstack/react-query';
import type { Species, TraitRef } from '@treerepro/contracts';
import { type ReactNode, useState } from 'react';
import { datasetKeys, fetchSpecies, fetchSpeciesTraits } from '../../api/dataset.ts';
import { AddNameDialog } from '../../components/catalog/AddNameDialog.tsx';
import { SpeciesDialog } from '../../components/catalog/SpeciesDialog.tsx';
import { AddValueDialog } from '../../components/curation/AddValueDialog.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { TraitCard } from '../../components/dataset/TraitCard.tsx';
import { TraitPanel } from '../../components/dataset/TraitPanel.tsx';
import { Alert, Badge, Button, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { detailErrorMessage } from '../../lib/errors.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

function errorMessage(error: unknown): string {
  return detailErrorMessage(error, 'SPECIES_NOT_FOUND', 'This species does not exist.');
}

// Family › Genus; a missing family (or both) reads as RFC-60 R3's term.
function taxonomyLine(species: Species): string {
  return [species.family?.name ?? 'unresolved taxonomy', species.genus?.name]
    .filter((part): part is string => part !== undefined)
    .join(' › ');
}

function SpeciesHeader({ species, actions }: { species: Species; actions?: ReactNode }) {
  const names = species.names.map((n) => n.name);
  return (
    <PageHeader
      title={
        <span className="flex flex-wrap items-center gap-3">
          <em>{species.canonicalName}</em>
          {species.unresolvedTaxon ? <Badge tone="amber">unresolved taxon</Badge> : null}
          {species.active ? null : <Badge tone="neutral">inactive</Badge>}
        </span>
      }
      description={
        <>
          <span className="block">{taxonomyLine(species)}</span>
          {names.length > 0 ? (
            <span className="block">
              Also known as <span className="italic">{names.join(', ')}</span>
            </span>
          ) : null}
          <span className="block">
            {species.recordCount} {species.recordCount === 1 ? 'record' : 'records'} ·{' '}
            {species.traitCount} {species.traitCount === 1 ? 'trait' : 'traits'}
          </span>
        </>
      }
      actions={actions}
    />
  );
}

/**
 * One species: its taxonomy and names (RFC-60 R7) and, per category in
 * dictionary order, a card per trait with the summary the API computed
 * (RFC-63 R10). A card opens the trait's records in a panel; a row there
 * opens the record's detail in a drawer on top. With `records.create`, an
 * "Add value" button in the header and one on each trait card open the
 * add-value dialog (RFC-65 R1) — the header button without a fixed trait,
 * a card's button with its trait. Both fetches fail together for an unknown
 * id, so one alert covers the page. The open panel is remembered by trait
 * id and its summary read from the traits query on every render, so the
 * accepted badge follows a Clear or a Set-as-accepted (which invalidate the
 * summary) instead of freezing at the click; a trait that leaves the summary
 * closes its panel. With `taxa.manage`, "Edit species" and "Add name" in the
 * header open the species editor and the alternative-name dialog (RFC-60
 * R9); their write invalidates the species detail, so the header re-renders
 * from the refetch. An inactive species is flagged after the unresolved-taxon
 * badge (RFC-33 R7).
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-60 R7, R9
 * @rfc RFC-33 R7
 * @rfc RFC-63 R10
 * @rfc RFC-65 R1, R6
 */
export function SpeciesPage({ id }: { id: string }) {
  const me = useMe();
  const canAdd = hasPermission(me, 'records.create');
  const canManageTaxa = hasPermission(me, 'taxa.manage');
  const species = useQuery({
    queryKey: datasetKeys.speciesDetail(id),
    queryFn: () => fetchSpecies(id),
  });
  const traits = useQuery({
    queryKey: datasetKeys.speciesTraits(id),
    queryFn: () => fetchSpeciesTraits(id),
  });
  const [openTraitId, setOpenTraitId] = useState<string | null>(null);
  const openTrait =
    openTraitId === null
      ? undefined
      : traits.data?.flatMap((c) => c.traits).find((t) => t.trait.id === openTraitId);
  // The trait left the summary (a refetch no longer lists it): forget it
  // during this render so a later summary cannot reopen the panel unasked.
  if (openTraitId !== null && traits.data && !openTrait) setOpenTraitId(null);
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ trait: TraitRef | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingName, setAddingName] = useState(false);
  const error = species.error ?? traits.error;

  return (
    <>
      {species.data ? (
        <SpeciesHeader
          species={species.data}
          actions={
            canAdd || canManageTaxa ? (
              <>
                {canAdd ? (
                  <Button onClick={() => setAdding({ trait: null })}>Add value</Button>
                ) : null}
                {canManageTaxa ? (
                  <>
                    <Button variant="secondary" onClick={() => setEditing(true)}>
                      Edit species
                    </Button>
                    <Button variant="secondary" onClick={() => setAddingName(true)}>
                      Add name
                    </Button>
                  </>
                ) : null}
              </>
            ) : undefined
          }
        />
      ) : (
        <PageHeader title="Species" />
      )}
      <div className="flex flex-col gap-8">
        {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
        {!error && (species.isPending || traits.isPending) ? (
          <p className="text-body text-mist-500">Loading…</p>
        ) : null}
        {species.isSuccess && traits.data && traits.data.length === 0 ? (
          <EmptyState title="No trait records for this species yet." />
        ) : null}
        {species.isSuccess &&
          traits.data?.map((category) => (
            <section key={category.category.key} className="flex flex-col gap-3">
              <h2 className="font-display text-section font-semibold text-canopy-950">
                {category.category.label}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {category.traits.map((summary) => (
                  <TraitCard
                    key={summary.trait.id}
                    summary={summary}
                    onOpen={() => setOpenTraitId(summary.trait.id)}
                    onAdd={canAdd ? () => setAdding({ trait: summary.trait }) : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>
      {openTrait ? (
        <TraitPanel
          speciesId={id}
          summary={openTrait}
          onClose={() => setOpenTraitId(null)}
          onSelectRecord={setOpenRecord}
        />
      ) : null}
      <RecordDrawer
        recordId={openRecord}
        onClose={() => setOpenRecord(null)}
        onOpenRecord={setOpenRecord}
      />
      {adding ? (
        <AddValueDialog
          speciesId={id}
          initialTrait={adding.trait}
          onClose={() => setAdding(null)}
          onCreated={(record) => {
            setAdding(null);
            setOpenRecord(record.id);
          }}
          onOpenRecord={(recordId) => {
            setAdding(null);
            setOpenRecord(recordId);
          }}
        />
      ) : null}
      {editing && species.data ? (
        <SpeciesDialog
          species={species.data}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
      {addingName && species.data ? (
        <AddNameDialog
          species={species.data}
          onClose={() => setAddingName(false)}
          onSaved={() => setAddingName(false)}
        />
      ) : null}
    </>
  );
}
