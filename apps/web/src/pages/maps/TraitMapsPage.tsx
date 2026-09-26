import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { MapEntry, MapKind, Trait, TraitLevel } from '@treerepro/contracts';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
import { MAP_KIND_LABELS, mapAlt, mapsByTrait, useMaps } from '../../api/maps.ts';
import { MapFigure } from '../../components/maps/MapFigure.tsx';
import { useBreadcrumb } from '../../components/shell/Breadcrumb.tsx';
import { Alert, ButtonLink, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';

const QUANTITATIVE_KINDS = ['mean', 'min', 'max', 'sd'] as const satisfies readonly MapKind[];

// `caption` is on every map (RFC-76 R7): TDWG level 3 regions, the date the
// manifest row carries — never computed, only read.
function caption(entry: MapEntry): string {
  return `TDWG level 3 regions · ${entry.dataVersion}`;
}

/**
 * `/app/maps/$traitId` (RFC-76 R7): the completeness map full width at the
 * top, then a grid of prevalence maps in dictionary level order for a
 * categorical trait, or a Mean/Min/Max/SD grid for a quantitative one —
 * either way, a kind the manifest has no entry for is left out rather than
 * an empty frame. Previous/next step through the traits with maps in the
 * same dictionary category, in dictionary order. Names, levels and the
 * category come from the dictionary; only which maps exist comes from the
 * manifest (`useMaps`). A trait the viewer's manifest has no map for — or
 * that is not in the dictionary at all — reads "No maps for this trait."
 * @rfc RFC-76 R7
 */
export function TraitMapsPage({ traitId }: { traitId: string }) {
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const maps = useMaps();
  const error = dictionary.error ?? maps.error;
  const isPending = dictionary.isPending || maps.isPending;

  const byTrait = mapsByTrait(maps.data ?? []);
  const category = (dictionary.data ?? []).find((c) => c.traits.some((t) => t.id === traitId));
  const trait = category?.traits.find((t) => t.id === traitId);
  const entries = byTrait.get(traitId) ?? [];
  const traitName = trait ? humaniseKey(trait.key) : undefined;

  // The Breadcrumb type carries no `hash` option (RFC-13 R3's `Crumb`), so
  // the category crumb links to the maps catalog page rather than its own
  // anchor there.
  useBreadcrumb(
    category && traitName ? [{ label: category.label, to: '/app/maps' }, { label: traitName }] : [],
  );

  if (error) {
    return <Alert tone="error">{pageErrorMessage(error)}</Alert>;
  }
  if (isPending) {
    return (
      <>
        <PageHeader title="Maps" />
        <p className="text-body text-mist-500">Loading…</p>
      </>
    );
  }
  if (!trait || !traitName || entries.length === 0) {
    return (
      <>
        <PageHeader title="Maps" />
        <EmptyState title="No maps for this trait." />
      </>
    );
  }

  const siblings = (category?.traits ?? []).filter((t) => (byTrait.get(t.id) ?? []).length > 0);
  const index = siblings.findIndex((t) => t.id === traitId);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;
  const completeness = entries.find((entry) => entry.kind === 'completeness');

  return (
    <>
      <PageHeader
        title={traitName}
        description={category?.label}
        actions={
          <ButtonLink to="/app/traits/$id" params={{ id: trait.id }}>
            Trait details
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-10">
        {completeness ? (
          <section aria-labelledby="completeness-heading">
            <h2
              id="completeness-heading"
              className="mb-4 font-display text-section font-semibold text-canopy-950"
            >
              Data completeness
            </h2>
            <MapFigure
              entry={completeness}
              alt={mapAlt('completeness', traitName)}
              caption={caption(completeness)}
            />
          </section>
        ) : null}
        {trait.valueType === 'categorical' ? (
          <PrevalenceSection trait={trait} entries={entries} traitName={traitName} />
        ) : (
          <SummarySection entries={entries} traitName={traitName} />
        )}
      </div>
      {previous || next ? (
        <nav
          aria-label="Trait maps navigation"
          className="mt-10 flex items-center justify-between gap-4 border-t border-canopy-700/10 pt-6"
        >
          {previous ? (
            <Link
              to="/app/maps/$traitId"
              params={{ traitId: previous.id }}
              className="text-label font-semibold text-canopy-800 hover:underline"
            >
              Previous: {humaniseKey(previous.key)}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to="/app/maps/$traitId"
              params={{ traitId: next.id }}
              className="text-label font-semibold text-canopy-800 hover:underline"
            >
              Next: {humaniseKey(next.key)}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

// The prevalence grid, in dictionary level order (RFC-76 R7): a level with
// no matching manifest entry is left out entirely rather than shown as an
// empty frame.
function PrevalenceSection({
  trait,
  entries,
  traitName,
}: {
  trait: Trait;
  entries: MapEntry[];
  traitName: string;
}) {
  const prevalence = entries.filter((entry) => entry.kind === 'prevalence');
  const levels = [...trait.levels]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((level) => ({ level, entry: prevalence.find((entry) => entry.levelId === level.id) }))
    .filter((item): item is { level: TraitLevel; entry: MapEntry } => item.entry !== undefined);
  if (levels.length === 0) return null;

  return (
    <section aria-labelledby="prevalence-heading">
      <h2
        id="prevalence-heading"
        className="mb-4 font-display text-section font-semibold text-canopy-950"
      >
        Prevalence by level
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {levels.map(({ level, entry }) => (
          <div key={level.id} className="flex flex-col gap-2">
            <h3 className="text-label font-semibold text-canopy-900">{humaniseKey(level.key)}</h3>
            <MapFigure
              entry={entry}
              alt={mapAlt('prevalence', traitName, humaniseKey(level.key))}
              caption={caption(entry)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// The Mean / Min / Max / SD grid, missing kinds left out (RFC-76 R7).
function SummarySection({ entries, traitName }: { entries: MapEntry[]; traitName: string }) {
  const kinds = QUANTITATIVE_KINDS.map((kind) =>
    entries.find((entry) => entry.kind === kind),
  ).filter((entry): entry is MapEntry => entry !== undefined);
  if (kinds.length === 0) return null;

  return (
    <section aria-labelledby="summary-heading">
      <h2
        id="summary-heading"
        className="mb-4 font-display text-section font-semibold text-canopy-950"
      >
        Summary statistics
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {kinds.map((entry) => (
          <div key={entry.kind} className="flex flex-col gap-2">
            <h3 className="text-label font-semibold text-canopy-900">
              {MAP_KIND_LABELS[entry.kind]}
            </h3>
            <MapFigure entry={entry} alt={mapAlt(entry.kind, traitName)} caption={caption(entry)} />
          </div>
        ))}
      </div>
    </section>
  );
}
