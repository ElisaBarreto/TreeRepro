import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { MapEntry, Trait } from '@treerepro/contracts';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
import { mapAlt, mapsByTrait, useMaps } from '../../api/maps.ts';
import { MapFigure } from '../../components/maps/MapFigure.tsx';
import { useBreadcrumb } from '../../components/shell/Breadcrumb.tsx';
import { Alert, Badge, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey, TRAIT_VALUE_TYPE_LABELS } from '../../lib/format.ts';

interface TraitCard {
  trait: Trait;
  thumbnail: MapEntry;
}

/**
 * `/app/maps`: a sticky jump bar of the dictionary categories that have at
 * least one map, each a card grid below it — one card per trait with maps,
 * its completeness map as a thumbnail (its first map when it has none),
 * linking to that trait's own maps page. A trait without maps, or a
 * category with none of its own, is left out entirely; with no maps at all
 * the page reads "No maps yet." Names, levels and categories always come
 * from the dictionary, never from the manifest — the manifest only decides
 * which of them are worth a card.
 * @rfc RFC-76 R6
 */
export function MapsPage() {
  useBreadcrumb([{ label: 'Maps' }]);
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const maps = useMaps();
  const byTrait = mapsByTrait(maps.data ?? []);
  const categories = (dictionary.data ?? [])
    .map((category) => ({
      ...category,
      cards: category.traits
        .map((trait) => {
          const entries = byTrait.get(trait.id) ?? [];
          const thumbnail = entries.find((entry) => entry.kind === 'completeness') ?? entries[0];
          return thumbnail ? { trait, thumbnail } : null;
        })
        .filter((card): card is TraitCard => card !== null),
    }))
    .filter((category) => category.cards.length > 0);
  const error = dictionary.error ?? maps.error;
  const isPending = dictionary.isPending || maps.isPending;
  const succeeded = dictionary.isSuccess && maps.isSuccess;

  return (
    <>
      <PageHeader title="Maps" description="Global maps per trait, by TDWG level 3 region." />
      {error ? <Alert tone="error">{pageErrorMessage(error)}</Alert> : null}
      {isPending ? <p className="text-body text-mist-500">Loading…</p> : null}
      {succeeded && categories.length === 0 ? <EmptyState title="No maps yet." /> : null}
      {categories.length > 0 ? (
        <nav
          aria-label="Trait categories"
          className="sticky top-0 z-10 -mx-1 mb-6 flex gap-2 overflow-x-auto whitespace-nowrap bg-mist-50 px-1 py-3"
        >
          {categories.map((category) => (
            <a
              key={category.key}
              href={`#${category.key}`}
              className="shrink-0 rounded-full border border-canopy-700/15 bg-white px-3.5 py-1.5 text-label font-semibold text-canopy-800 transition-colors hover:bg-canopy-50"
            >
              {category.label}
            </a>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-col gap-10">
        {categories.map((category) => (
          <CategorySection
            key={category.key}
            categoryKey={category.key}
            label={category.label}
            cards={category.cards}
          />
        ))}
      </div>
    </>
  );
}

function CategorySection({
  categoryKey,
  label,
  cards,
}: {
  categoryKey: string;
  label: string;
  cards: TraitCard[];
}) {
  const headingId = `${categoryKey}-heading`;
  return (
    <section id={categoryKey} aria-labelledby={headingId} className="scroll-mt-20">
      <h2 id={headingId} className="mb-4 font-display text-section font-semibold text-canopy-950">
        {label}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map(({ trait, thumbnail }) => (
          <Link
            key={trait.id}
            to="/app/maps/$traitId"
            params={{ traitId: trait.id }}
            className="flex flex-col gap-3 rounded-xl border border-canopy-700/10 bg-white p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
          >
            <MapFigure
              entry={thumbnail}
              alt={mapAlt(thumbnail.kind, humaniseKey(trait.key))}
              size="thumb"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-canopy-950">{humaniseKey(trait.key)}</span>
              <Badge>{TRAIT_VALUE_TYPE_LABELS[trait.valueType]}</Badge>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
