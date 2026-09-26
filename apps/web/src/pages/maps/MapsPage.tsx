import { useQuery } from '@tanstack/react-query';
import type { MapEntry, Trait } from '@treerepro/contracts';
import { type KeyboardEvent, useState } from 'react';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
import { MAP_KIND_LABELS, mapAlt, mapsByTrait, useMaps } from '../../api/maps.ts';
import { MapFigure } from '../../components/maps/MapFigure.tsx';
import { MapViewer, type MapViewerItem } from '../../components/maps/MapViewer.tsx';
import { Alert, Badge, ButtonLink, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey, TRAIT_VALUE_TYPE_LABELS } from '../../lib/format.ts';

/** The page's search params (RFC-76 R6): a category key and a trait key. @rfc RFC-76 R6 */
export interface MapsSearch {
  category?: string;
  trait?: string;
}

// The trait page's tab look (`TraitPage.tsx`), kept on one scrolling line.
const TAB =
  'h-11 shrink-0 whitespace-nowrap border-b-2 px-4 text-body font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';
const TAB_SELECTED = 'border-canopy-700 text-canopy-950';
const TAB_IDLE = 'border-transparent text-mist-500 hover:text-canopy-800';
// The dashboard's toggle pill (`TopGaps.tsx`).
const TOGGLE_BUTTON =
  'rounded-full border border-canopy-700/25 px-3.5 py-1.5 text-meta font-semibold text-canopy-900 transition-colors hover:bg-mist-100 aria-pressed:border-transparent aria-pressed:bg-canopy-900 aria-pressed:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';
// The species search's filter-group legend.
const EYEBROW = 'text-label font-bold uppercase tracking-[0.08em] text-canopy-800';
const SECTION_HEADING = 'font-display text-body font-semibold text-canopy-950';
const NOTE = 'text-meta text-mist-500';

const COMPLETENESS_LEGEND =
  'Share of tree species with data for this trait in each TDWG level-3 region.';
const PREVALENCE_LEGEND =
  "Share of the region's tree species with data for this trait that hold each level; a species with several levels counts under each.";
const SUMMARY_KINDS = [
  { kind: 'mean', note: 'Mean of the species means in the region.' },
  { kind: 'min', note: 'Lowest species mean in the region.' },
  { kind: 'max', note: 'Highest species mean in the region.' },
  { kind: 'sd', note: 'Standard deviation of the species means in the region.' },
] as const;

const tabId = (key: string) => `maps-tab-${key}`;
const traitButtonId = (key: string) => `maps-trait-${key}`;

/**
 * The index `key` moves to from `index` among `count` items, wrapping —
 * `undefined` for a key that moves nothing. Up/Down count only where
 * `vertical` is set (trait buttons), Home/End only where `homeEnd` is (tabs).
 */
function moveIndex(
  key: string,
  index: number,
  count: number,
  { vertical, homeEnd }: { vertical: boolean; homeEnd: boolean },
): number | undefined {
  if (key === 'ArrowRight' || (vertical && key === 'ArrowDown')) return (index + 1) % count;
  if (key === 'ArrowLeft' || (vertical && key === 'ArrowUp')) return (index - 1 + count) % count;
  if (homeEnd && key === 'Home') return 0;
  if (homeEnd && key === 'End') return count - 1;
  return undefined;
}

/**
 * `/app/maps` (RFC-76 R6, R7): one dictionary category at a time. A tab bar
 * of the categories with maps, then the selected category's traits with
 * maps as buttons, then the selected trait's maps — completeness first,
 * then Mean/Min/Max/SD or the prevalence of each level — each labelled.
 * `?trait=` alone selects its category; an unknown or mapless key falls
 * back to the first. Names, levels and categories come from the dictionary;
 * the manifest only says which maps exist. The shell's own trail already
 * reads `Data › Maps`, so the page registers no crumb of its own.
 * @rfc RFC-76 R6, R7
 */
export function MapsPage({
  search,
  onSearchChange,
}: {
  search: MapsSearch;
  onSearchChange: (next: MapsSearch) => void;
}) {
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const maps = useMaps();
  const byTrait = mapsByTrait(maps.data ?? []);
  const categories = (dictionary.data ?? [])
    .map((category) => ({
      ...category,
      traits: category.traits.filter((trait) => byTrait.has(trait.id)),
    }))
    .filter((category) => category.traits.length > 0);
  const category =
    categories.find((c) => c.traits.some((t) => t.key === search.trait)) ??
    categories.find((c) => c.key === search.category) ??
    categories[0];
  const trait = category?.traits.find((t) => t.key === search.trait) ?? category?.traits[0];

  const error = dictionary.error ?? maps.error;
  const isPending = dictionary.isPending || maps.isPending;
  const succeeded = dictionary.isSuccess && maps.isSuccess;

  function selectCategory(key: string) {
    onSearchChange({ category: key, trait: undefined });
  }

  function onTabKeyDown(event: KeyboardEvent, index: number) {
    const next = moveIndex(event.key, index, categories.length, { vertical: false, homeEnd: true });
    const target = next === undefined ? undefined : categories[next];
    if (!target) return;
    event.preventDefault();
    selectCategory(target.key);
    document.getElementById(tabId(target.key))?.focus();
  }

  return (
    <>
      <PageHeader
        title="Maps"
        description="Global maps per trait, by TDWG level 3 region. Choose a category, then a trait."
      />
      {error ? <Alert tone="error">{pageErrorMessage(error)}</Alert> : null}
      {isPending ? <p className="text-body text-mist-500">Loading…</p> : null}
      {succeeded && !category ? <EmptyState title="No maps yet." /> : null}
      {category && trait ? (
        <>
          <div
            role="tablist"
            aria-label="Trait categories"
            className="mb-6 flex gap-1 overflow-x-auto border-b border-canopy-700/15"
          >
            {categories.map((c, index) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                id={tabId(c.key)}
                aria-selected={c.key === category.key}
                aria-controls="maps-panel"
                tabIndex={c.key === category.key ? 0 : -1}
                className={`${TAB} ${c.key === category.key ? TAB_SELECTED : TAB_IDLE}`}
                onClick={() => selectCategory(c.key)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id="maps-panel"
            aria-labelledby={tabId(category.key)}
            className="flex flex-col gap-6"
          >
            <section className="flex flex-col gap-3">
              <h2 className={EYEBROW}>{category.label}</h2>
              <TraitButtons
                categoryLabel={category.label}
                traits={category.traits}
                selected={trait}
                onSelect={(key) => onSearchChange({ category: category.key, trait: key })}
              />
            </section>
            <TraitMaps key={trait.id} trait={trait} entries={byTrait.get(trait.id) ?? []} />
          </div>
        </>
      ) : null}
    </>
  );
}

function TraitButtons({
  categoryLabel,
  traits,
  selected,
  onSelect,
}: {
  categoryLabel: string;
  traits: Trait[];
  selected: Trait;
  onSelect: (key: string) => void;
}) {
  function onKeyDown(event: KeyboardEvent, index: number) {
    const next = moveIndex(event.key, index, traits.length, { vertical: true, homeEnd: false });
    const target = next === undefined ? undefined : traits[next];
    if (!target) return;
    event.preventDefault();
    onSelect(target.key);
    document.getElementById(traitButtonId(target.key))?.focus();
  }

  return (
    <fieldset
      aria-label={`Traits in ${categoryLabel}`}
      className="flex min-w-0 flex-wrap gap-2 border-0 p-0"
    >
      {traits.map((t, index) => (
        <button
          key={t.id}
          type="button"
          id={traitButtonId(t.key)}
          aria-pressed={t.id === selected.id}
          tabIndex={t.id === selected.id ? 0 : -1}
          className={TOGGLE_BUTTON}
          onClick={() => onSelect(t.key)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {humaniseKey(t.key)}
        </button>
      ))}
    </fieldset>
  );
}

interface TraitMap extends MapViewerItem {
  id: string;
  note?: string;
}

// The selected trait's maps in page order (RFC-76 R7): completeness, then
// the summary kinds or the levels in dictionary order, a missing one left
// out. The viewer steps through this same list.
function traitMaps(trait: Trait, entries: MapEntry[]) {
  const name = humaniseKey(trait.key);
  const completenessEntry = entries.find((entry) => entry.kind === 'completeness');
  const completeness: TraitMap | undefined = completenessEntry && {
    id: 'completeness',
    entry: completenessEntry,
    heading: MAP_KIND_LABELS.completeness,
    alt: mapAlt('completeness', name),
  };
  const details: TraitMap[] =
    trait.valueType === 'categorical'
      ? [...trait.levels]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .flatMap((level) => {
            const entry = entries.find((e) => e.kind === 'prevalence' && e.levelId === level.id);
            const levelName = humaniseKey(level.key);
            return entry
              ? [
                  {
                    id: level.id,
                    entry,
                    heading: levelName,
                    alt: mapAlt('prevalence', name, levelName),
                  },
                ]
              : [];
          })
      : SUMMARY_KINDS.flatMap(({ kind, note }) => {
          const entry = entries.find((e) => e.kind === kind);
          return entry
            ? [{ id: kind, entry, heading: MAP_KIND_LABELS[kind], alt: mapAlt(kind, name), note }]
            : [];
        });
  return { completeness, details };
}

function TraitMaps({ trait, entries }: { trait: Trait; entries: MapEntry[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const { completeness, details } = traitMaps(trait, entries);
  const items = completeness ? [completeness, ...details] : details;
  const offset = completeness ? 1 : 0;
  const categorical = trait.valueType === 'categorical';

  return (
    <article className="flex flex-col gap-8 rounded-xl border border-canopy-700/10 bg-white p-4 shadow-sm sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-section font-semibold text-canopy-950">
            {humaniseKey(trait.key)}
          </h3>
          <Badge>{TRAIT_VALUE_TYPE_LABELS[trait.valueType]}</Badge>
        </div>
        <ButtonLink to="/app/traits/$id" params={{ id: trait.id }} size="sm">
          Trait details
        </ButtonLink>
      </header>
      {completeness ? (
        <section className="flex flex-col gap-3">
          <div>
            <h4 className={SECTION_HEADING}>Data completeness</h4>
            <p className={NOTE}>{COMPLETENESS_LEGEND}</p>
          </div>
          <MapFigure
            entry={completeness.entry}
            alt={completeness.alt}
            caption={caption(completeness.entry)}
            onOpen={() => setOpen(0)}
          />
        </section>
      ) : null}
      {details.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div>
            <h4 className={SECTION_HEADING}>
              {categorical ? 'Prevalence by level' : 'Summary statistics'}
            </h4>
            {categorical ? <p className={NOTE}>{PREVALENCE_LEGEND}</p> : null}
          </div>
          <div
            className={`grid gap-x-6 gap-y-8 ${categorical ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2'}`}
          >
            {details.map((map, index) => (
              <div key={map.id} className="flex min-w-0 flex-col gap-2">
                <div>
                  <h5 className="text-label font-semibold text-canopy-900">{map.heading}</h5>
                  {map.note ? <p className={NOTE}>{map.note}</p> : null}
                </div>
                <MapFigure
                  entry={map.entry}
                  alt={map.alt}
                  caption={caption(map.entry)}
                  onOpen={() => setOpen(index + offset)}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <MapViewer items={items} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />
    </article>
  );
}

// Every map's caption (RFC-76 R7): the manifest row's data version, read, never computed.
function caption(entry: MapEntry): string {
  return `TDWG level 3 regions · ${entry.dataVersion}`;
}
