import { useQuery } from '@tanstack/react-query';
import type { Species, TraitSummary } from '@treerepro/contracts';
import { useState } from 'react';
import { datasetKeys, fetchSpecies, fetchSpeciesTraits } from '../../api/dataset.ts';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { TraitCard } from '../../components/dataset/TraitCard.tsx';
import { TraitPanel } from '../../components/dataset/TraitPanel.tsx';
import { Alert, Badge, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { detailErrorMessage } from '../../lib/errors.ts';

function errorMessage(error: unknown): string {
  return detailErrorMessage(error, 'SPECIES_NOT_FOUND', 'This species does not exist.');
}

// Family › Genus; a missing family (or both) reads as RFC-60 R3's term.
function taxonomyLine(species: Species): string {
  return [species.family?.name ?? 'unresolved taxonomy', species.genus?.name]
    .filter((part): part is string => part !== undefined)
    .join(' › ');
}

function SpeciesHeader({ species }: { species: Species }) {
  const names = species.names.map((n) => n.name);
  return (
    <PageHeader
      title={
        <span className="flex flex-wrap items-center gap-3">
          <em>{species.canonicalName}</em>
          {species.unresolvedTaxon ? <Badge tone="amber">unresolved taxon</Badge> : null}
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
    />
  );
}

/**
 * One species: its taxonomy and names (RFC-60 R7) and, per category in
 * dictionary order, a card per trait with the summary the API computed
 * (RFC-63 R10). A card opens the trait's records in a panel; a row there
 * opens the record's detail in a drawer on top. Both fetches fail together
 * for an unknown id, so one alert covers the page.
 * @rfc RFC-13 R2, R4
 * @rfc RFC-60 R7
 * @rfc RFC-63 R10
 */
export function SpeciesPage({ id }: { id: string }) {
  const species = useQuery({
    queryKey: datasetKeys.speciesDetail(id),
    queryFn: () => fetchSpecies(id),
  });
  const traits = useQuery({
    queryKey: datasetKeys.speciesTraits(id),
    queryFn: () => fetchSpeciesTraits(id),
  });
  const [openTrait, setOpenTrait] = useState<TraitSummary | null>(null);
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const error = species.error ?? traits.error;

  return (
    <>
      {species.data ? <SpeciesHeader species={species.data} /> : <PageHeader title="Species" />}
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
                    onOpen={() => setOpenTrait(summary)}
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
          onClose={() => setOpenTrait(null)}
          onSelectRecord={setOpenRecord}
        />
      ) : null}
      <RecordDrawer recordId={openRecord} onClose={() => setOpenRecord(null)} />
    </>
  );
}
