import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  PLANT_TYPE_LABELS,
  PLANT_TYPES,
  type PlantType,
  type SortOrder,
  type SpeciesSort,
  type SpeciesStatus,
  TREE_FLAG_LABELS,
  TREE_FLAGS,
  type TraitDataMode,
  type TreeFlag,
  type WcvpRegion,
} from '@treerepro/contracts';
import { Fragment, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import {
  datasetKeys,
  fetchDictionary,
  fetchTreeFlagCounts,
  fetchWcvpRegions,
} from '../../api/dataset.ts';
import { listPlots, plotKeys } from '../../api/plots.ts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { Field, Select } from '../ui/index.ts';
import { FILTER_CHECK, FILTER_LEGEND, FilterGroup } from './FilterGroup.tsx';
import { TaxonomyFilters } from './TaxonomyFilters.tsx';

export interface SpeciesSearchValue {
  q: string;
  familyId?: string;
  genusId?: string;
  unresolved: boolean;
  contested: boolean;
  unknownLevels: boolean;
  outliers?: boolean;
  status?: SpeciesStatus;
  scope?: 'plots' | 'all';
  plotId?: string;
  categoryKey?: string;
  traitId?: string;
  traitData?: TraitDataMode;
  /** RFC-60 R6: the checked tree bases; absent when none is checked. */
  treeFlags?: TreeFlag[];
  /** RFC-60 R6: one plant type; absent shows every type. */
  plantType?: PlantType;
  /** RFC-60 R6: the checked WCVP level-1, level-2 and level-3 codes; absent when none is. */
  continents?: string[];
  regions?: string[];
  areas?: string[];
  /** Count introduced occurrences too. */
  introduced?: boolean;
  sort?: SpeciesSort;
  /** The table headers' direction (RFC-60 R6, RFC-13 R13). */
  order?: SortOrder;
}

/**
 * The filters of the species search, in three groups.
 *
 * **Taxonomy** — {@link TaxonomyFilters}, the group the trait page renders
 * too, with the unresolved-taxa toggle this form alone offers.
 *
 * **Traits** (RFC-60 R6 amendment) — a category select fed by the trait
 * dictionary, a trait select filtered to that category (every trait, grouped
 * by category, while none is chosen; issue #313) and a "Has data" / "Missing data" radio pair (disabled
 * until a category or trait is chosen). A value that names a trait and no
 * category — what `/app/species?traitId=…` deep links carry — shows the
 * trait's own category, read out of the dictionary, so the filter in force
 * is visible and clearable. Choosing another category drops the trait, which
 * belonged to the old one; going back to "All categories" clears the whole
 * group, the derived category included, and so does going back to "All
 * traits" when the category was the trait's own — the mode never outlives
 * both of its companions. The radio shows "Has data" while nothing is
 * chosen because that is the API's default mode; the value only carries
 * `traitData` once the contributor picks a side.
 *
 * **Geography** ({@link GeographyFilters}) — continent, region and
 * botanical country, with introduced occurrences on request.
 *
 * **Scope** — the plot select, the outside-plots toggle and, with
 * `dataset.read_inactive`, the Status select (RFC-33 R6, R7, RFC-67 R8),
 * plus **Contested only** for everyone and **Has unknown levels** with
 * `records.review` (spec R-15); the unresolved toggle of the Taxonomy group
 * is shown with `records.review` only. The group itself always renders, so
 * the checkboxes it offers every viewer are always reachable. **Tree basis**
 * ({@link TreeBasisFilter}) closes it.
 *
 * Below the groups, **Order by** chooses between the name order and
 * "Most incomplete first" (`sort=completeness`). Fully controlled — the page
 * owns the value, the debounce of the name and the mirror into the URL.
 * @rfc RFC-13 R2
 * @rfc RFC-60 R6, R8
 * @rfc RFC-33 R6, R7, R8
 */
export function SpeciesSearchForm({
  value,
  onChange,
  treeFlagFilters = {},
}: {
  value: SpeciesSearchValue;
  onChange: (next: SpeciesSearchValue) => void;
  /** The search's filters as sent, but `treeFlag`: what the tree basis counts follow (RFC-60 R11). */
  treeFlagFilters?: Parameters<typeof fetchTreeFlagCounts>[0];
}) {
  const me = useMe();
  const ids = {
    status: useId(),
    plantType: useId(),
    plot: useId(),
    category: useId(),
    trait: useId(),
    traitData: useId(),
    sort: useId(),
  };
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });

  const hasPlots = Boolean(me.scope?.plots && me.scope.plots.length > 0);
  const canManagePlots = hasPermission(me, 'plots.manage');
  const canReadInactive = hasPermission(me, 'dataset.read_inactive');
  const canReview = hasPermission(me, 'records.review');
  const showScopeGroup = hasPlots || canManagePlots;

  const allPlotsQuery = useQuery({
    queryKey: plotKeys.list({ limit: 200 }),
    queryFn: () => listPlots({ limit: 200 }),
    enabled: canManagePlots,
  });
  const availablePlots = canManagePlots
    ? (allPlotsQuery.data?.data ?? me.scope?.plots ?? [])
    : (me.scope?.plots ?? []);

  // A deep link may name a trait and no category — `/app/species?traitId=…`
  // is the link the trait page and the dashboard send people to (RFC-60 R6
  // amendment). The category the trait belongs to is then read out of the
  // dictionary, so the group shows the filter that is actually in force
  // instead of "All categories / All traits", and the contributor can see it
  // and clear it. Until the dictionary arrives there is nothing to derive
  // from; the selects fill in once it does.
  const derivedCategory = value.traitId
    ? dictionary.data?.find((category) =>
        category.traits.some((trait) => trait.id === value.traitId),
      )?.key
    : undefined;
  const effectiveCategory = value.categoryKey ?? derivedCategory;
  const categoryTraits =
    dictionary.data?.find((category) => category.key === effectiveCategory)?.traits ?? [];
  // The API's default is `with`; the radio shows it before a side is picked.
  const traitData = value.traitData ?? 'with';
  const traitFilterChosen = Boolean(effectiveCategory ?? value.traitId);

  return (
    <div className="flex flex-col gap-4">
      <TaxonomyFilters
        showUnresolved={canReview}
        value={{
          q: value.q,
          familyId: value.familyId,
          genusId: value.genusId,
          unresolved: value.unresolved,
        }}
        onChange={(next) => onChange({ ...value, ...next, unresolved: next.unresolved === true })}
      />

      <FilterGroup title="Traits" columns="md:grid-cols-[1fr_1fr_auto]">
        <Field
          id={ids.category}
          label="Category"
          error={dictionary.isError ? 'Could not load the trait dictionary.' : undefined}
        >
          <Select
            id={ids.category}
            value={effectiveCategory ?? ''}
            onChange={(event) => {
              const categoryKey = event.target.value || undefined;
              onChange({
                ...value,
                categoryKey,
                // The trait belonged to the old category, and with no
                // category left there is nothing for a mode to apply to.
                traitId: undefined,
                traitData: categoryKey ? value.traitData : undefined,
              });
            }}
          >
            <option value="">All categories</option>
            {dictionary.data?.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={ids.trait} label="Trait">
          <Select
            id={ids.trait}
            value={value.traitId ?? ''}
            onChange={(event) => {
              const traitId = event.target.value || undefined;
              // When the category was derived from the trait, clearing the
              // trait clears the category with it, and a mode with neither
              // companion has nothing to apply to — the same rule the
              // category select applies when it goes back to all. A category
              // the contributor chose outright survives, and so does the mode.
              const stillFiltered = traitId !== undefined || value.categoryKey !== undefined;
              onChange({
                ...value,
                traitId,
                traitData: stillFiltered ? value.traitData : undefined,
              });
            }}
          >
            <option value="">All traits</option>
            {effectiveCategory
              ? categoryTraits.map((trait) => (
                  <option key={trait.id} value={trait.id}>
                    {humaniseKey(trait.key)}
                  </option>
                ))
              : dictionary.data?.map((category) => (
                  <optgroup key={category.key} label={category.label}>
                    {category.traits.map((trait) => (
                      <option key={trait.id} value={trait.id}>
                        {humaniseKey(trait.key)}
                      </option>
                    ))}
                  </optgroup>
                ))}
          </Select>
        </Field>
        <fieldset disabled={!traitFilterChosen} className="flex flex-col gap-2">
          <legend className={FILTER_LEGEND}>Data</legend>
          <div className="flex flex-wrap items-center gap-6">
            <label className={FILTER_CHECK}>
              <input
                type="radio"
                className="size-5 accent-canopy-700"
                name={ids.traitData}
                value="with"
                checked={traitData === 'with'}
                onChange={() => onChange({ ...value, traitData: 'with' })}
              />
              Has data
            </label>
            <label className={FILTER_CHECK}>
              <input
                type="radio"
                className="size-5 accent-canopy-700"
                name={ids.traitData}
                value="missing"
                checked={traitData === 'missing'}
                onChange={() => onChange({ ...value, traitData: 'missing' })}
              />
              Missing data
            </label>
          </div>
        </fieldset>
      </FilterGroup>

      <GeographyFilters value={value} onChange={(next) => onChange({ ...value, ...next })} />

      <FilterGroup title="Scope" columns="md:grid-cols-[1fr_1fr_auto]">
        {showScopeGroup ? (
          <Field id={ids.plot} label="Plot">
            <Select
              id={ids.plot}
              value={value.plotId ?? ''}
              onChange={(event) => onChange({ ...value, plotId: event.target.value || undefined })}
            >
              <option value="">All plots</option>
              {availablePlots.map((plot) => (
                <option key={plot.id} value={plot.id}>
                  {plot.code} — {plot.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {canReadInactive ? (
          <Field id={ids.status} label="Status">
            <Select
              id={ids.status}
              value={value.status ?? 'all'}
              onChange={(event) =>
                onChange({ ...value, status: event.target.value as SpeciesStatus })
              }
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        ) : null}
        {hasPlots && !me.scope.restricted ? (
          <label className={FILTER_CHECK}>
            <input
              type="checkbox"
              className="size-5 accent-canopy-700"
              checked={value.scope ? value.scope === 'all' : canReadInactive}
              onChange={(event) =>
                onChange({ ...value, scope: event.target.checked ? 'all' : 'plots' })
              }
            />
            Show species outside my plots
          </label>
        ) : null}
        <label className={FILTER_CHECK}>
          <input
            type="checkbox"
            className="size-5 accent-canopy-700"
            checked={value.contested}
            onChange={(event) => onChange({ ...value, contested: event.target.checked })}
          />
          Contested only
        </label>
        <label className={FILTER_CHECK}>
          <input
            type="checkbox"
            className="size-5 accent-canopy-700"
            checked={value.outliers === true}
            onChange={(event) => onChange({ ...value, outliers: event.target.checked })}
          />
          Outliers only
        </label>
        {canReview ? (
          <label className={FILTER_CHECK}>
            <input
              type="checkbox"
              className="size-5 accent-canopy-700"
              checked={value.unknownLevels}
              onChange={(event) => onChange({ ...value, unknownLevels: event.target.checked })}
            />
            Has unknown levels
          </label>
        ) : null}
        <Field id={ids.plantType} label="Plant type">
          <Select
            id={ids.plantType}
            value={value.plantType ?? ''}
            onChange={(event) =>
              onChange({
                ...value,
                plantType: (event.target.value || undefined) as PlantType | undefined,
              })
            }
          >
            <option value="">All</option>
            {PLANT_TYPES.map((type) => (
              <option key={type} value={type}>
                {PLANT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <TreeBasisFilter
          filters={treeFlagFilters}
          value={value.treeFlags ?? []}
          onChange={(flags) =>
            onChange({ ...value, treeFlags: flags.length > 0 ? flags : undefined })
          }
        />
      </FilterGroup>

      <div className="md:w-64">
        <Field id={ids.sort} label="Order by">
          <Select
            id={ids.sort}
            value={value.sort ?? 'name'}
            onChange={(event) =>
              onChange({
                ...value,
                // `name` is the API's default order; leaving it off keeps
                // the URL to the filters that actually narrow the list.
                sort: event.target.value === 'completeness' ? 'completeness' : undefined,
                order: undefined,
              })
            }
          >
            <option value="name">Name</option>
            <option value="completeness">Most incomplete first</option>
            {/* A table header chose another column: named, so the select
                does not claim the list is in name order. */}
            {value.sort && value.sort !== 'name' && value.sort !== 'completeness' ? (
              <option value={value.sort}>
                The {value.sort === 'treeBasis' ? 'tree basis' : value.sort} column
              </option>
            ) : null}
          </Select>
        </Field>
      </div>
    </div>
  );
}

type Geography = Pick<SpeciesSearchValue, 'continents' | 'regions' | 'areas' | 'introduced'>;

/** WCVP writes continents in capitals: `SOUTHERN AMERICA` reads `Southern America`. */
function titleCase(name: string): string {
  return name.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
}

/** The distinct `[code, name, continent]` of `rows`, in their order, dropping null codes. */
function distinct(rows: WcvpRegion[], code: 'continentCode' | 'regionCode') {
  const name = code === 'continentCode' ? 'continent' : 'region';
  const seen = new Map<string, [string, string | null]>();
  for (const r of rows) {
    const c = r[code];
    if (c !== null && !seen.has(c)) seen.set(c, [r[name] ?? c, r.continent]);
  }
  return [...seen].map(([c, [n, continent]]) => ({ code: c, name: n, continent }));
}

/** `undefined` for an empty list, so a cleared level leaves the URL. */
const orNone = (codes: string[]) => (codes.length > 0 ? codes : undefined);

/**
 * The geography filters (RFC-60 R6): Continent, Region and Botanical country
 * checkbox lists over the WCVP regions (R14). Region lists the regions of
 * the checked continents, else every one; Botanical country the botanical
 * countries of those continents, narrowed in each continent to its checked
 * regions when it has any; each is grouped under its continent. After any change a narrower choice no longer
 * listed is dropped. **Include introduced occurrences** is off by default,
 * disabled until a place is checked, and dropped with the last one.
 * @rfc RFC-60 R6, R14
 */
function GeographyFilters({
  value,
  onChange,
}: {
  value: Geography;
  onChange: (next: Geography) => void;
}) {
  const regions = useQuery({
    queryKey: datasetKeys.regions,
    queryFn: fetchWcvpRegions,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const rows = regions.data ?? [];
  const listed = (g: Geography) => {
    const c = g.continents ?? [];
    const r = g.regions ?? [];
    const inContinents =
      c.length > 0 ? rows.filter((x) => c.includes(x.continentCode ?? '')) : rows;
    // A checked region narrows its own continent only (RFC-60 R6).
    const narrowed = new Set(
      rows.filter((x) => r.includes(x.regionCode ?? '')).map((x) => x.continentCode),
    );
    const inRegions = inContinents.filter(
      (x) => !narrowed.has(x.continentCode) || r.includes(x.regionCode ?? ''),
    );
    return { inContinents, inRegions };
  };
  const { inContinents, inRegions } = listed(value);
  const set = (next: Geography) => {
    // Drop what the narrower lists no longer show, level by level — once the
    // regions are known, so a change made before they load keeps every choice.
    if (!regions.data) {
      const placed = Boolean(next.continents ?? next.regions ?? next.areas);
      onChange({ ...next, introduced: placed && next.introduced ? true : undefined });
      return;
    }
    const regionCodes = new Set(
      listed({ continents: next.continents }).inContinents.map((x) => x.regionCode),
    );
    const kept = {
      ...next,
      regions: orNone((next.regions ?? []).filter((r) => regionCodes.has(r))),
    };
    const areaCodes = new Set(listed(kept).inRegions.map((x) => x.code));
    kept.areas = orNone((kept.areas ?? []).filter((a) => areaCodes.has(a)));
    const placed = Boolean(kept.continents ?? kept.regions ?? kept.areas);
    onChange({ ...kept, introduced: placed && kept.introduced ? true : undefined });
  };
  const placed = Boolean(value.continents ?? value.regions ?? value.areas);
  return (
    <FilterGroup title="Geography" columns="md:grid-cols-[1fr_1fr_1fr_auto]">
      <CheckboxList
        legend="Continent"
        none="All continents"
        some={(n) => `${n} ${n === 1 ? 'continent' : 'continents'}`}
        error={regions.isError ? 'Could not load the WCVP regions.' : undefined}
        options={distinct(rows, 'continentCode').map((x) => ({
          value: x.code,
          label: titleCase(x.name),
        }))}
        value={value.continents ?? []}
        onChange={(continents) => set({ ...value, continents: orNone(continents) })}
      />
      <CheckboxList
        legend="Region"
        none="All regions"
        some={(n) => `${n} ${n === 1 ? 'region' : 'regions'}`}
        find="Find a region"
        options={distinct(inContinents, 'regionCode').map((x) => ({
          value: x.code,
          label: x.name,
          group: x.continent ? titleCase(x.continent) : undefined,
        }))}
        value={value.regions ?? []}
        onChange={(next) => set({ ...value, regions: orNone(next) })}
      />
      <CheckboxList
        legend="Botanical country"
        none="All botanical countries"
        some={(n) => `${n} botanical ${n === 1 ? 'country' : 'countries'}`}
        find="Find a botanical country"
        options={inRegions.map((x) => ({
          value: x.code,
          label: x.name,
          group: x.continent ? titleCase(x.continent) : undefined,
        }))}
        value={value.areas ?? []}
        onChange={(areas) => set({ ...value, areas: orNone(areas) })}
      />
      <label className={FILTER_CHECK}>
        <input
          type="checkbox"
          className="size-5 accent-canopy-700"
          disabled={!placed}
          checked={value.introduced === true}
          onChange={(event) => set({ ...value, introduced: event.target.checked })}
        />
        Include introduced occurrences
      </label>
    </FilterGroup>
  );
}

/**
 * The tree basis filter (RFC-60 R6): one checkbox per flag, in the
 * dictionary's order, each with the number of species it holds among those
 * the search's other filters keep (RFC-60 R11). None checked — the default —
 * keeps every species; checked ones keep the species whose flag is any of them.
 * @rfc RFC-60 R6, R11
 */
function TreeBasisFilter({
  filters,
  value,
  onChange,
}: {
  filters: Parameters<typeof fetchTreeFlagCounts>[0];
  value: TreeFlag[];
  onChange: (next: TreeFlag[]) => void;
}) {
  const counts = useQuery({
    queryKey: datasetKeys.treeFlagCounts(filters ?? {}),
    queryFn: () => fetchTreeFlagCounts(filters),
    // The previous numbers stay on screen while the next filters' load.
    placeholderData: keepPreviousData,
  });
  const countOf = new Map(counts.data?.map((c) => [c.treeFlag, c.speciesCount]));
  return (
    <CheckboxList
      legend="Tree basis"
      none="All tree bases"
      some={(n) => `${n} tree ${n === 1 ? 'basis' : 'bases'}`}
      align="right-0"
      options={TREE_FLAGS.map((flag) => ({
        value: flag,
        label: countOf.has(flag)
          ? `${TREE_FLAG_LABELS[flag]} (n = ${formatNumber(countOf.get(flag) ?? 0)})`
          : TREE_FLAG_LABELS[flag],
      }))}
      value={value}
      onChange={(next) => onChange(next as TreeFlag[])}
    />
  );
}

/** Lower case without diacritics, so `Nepál` finds `Nepal`. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * A closed control dressed like a select that opens onto one checkbox per
 * option, under a heading per `group` when given; the checked values are
 * reported in the options' order. Up and down arrows move between the boxes,
 * wrapping; a click outside the list or Escape closes it, as a select does.
 * A long list scrolls. With `find`, the list opens with a box that narrows it
 * to the options whose label or value holds the text, ignoring case and
 * accents; the text clears when the list closes.
 * @rfc RFC-60 R6
 */
function CheckboxList({
  legend,
  none,
  some,
  options,
  value,
  onChange,
  error,
  align = 'left-0',
  find,
}: {
  legend: string;
  /** The closed control's text while nothing is checked. */
  none: string;
  /** Its text for `n` checked boxes. */
  some: (n: number) => string;
  options: { value: string; label: string; group?: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
  /** The edge the open list hangs from. */
  align?: 'left-0' | 'right-0';
  /** The accessible name of the box that narrows the list; no box without it. */
  find?: string;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const findBox = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const needle = fold(text.trim());
  const shown = needle
    ? options.filter((o) => fold(o.label).includes(needle) || fold(o.value).includes(needle))
    : options;
  useEffect(() => {
    if (open) findBox.current?.focus();
    else setText('');
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!details.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);
  function moveFocus(event: KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      details.current?.querySelector('summary')?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const boxes = [...event.currentTarget.querySelectorAll<HTMLInputElement>('input')];
    const at = boxes.indexOf(document.activeElement as HTMLInputElement);
    if (at === -1) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    boxes[(at + step + boxes.length) % boxes.length]?.focus();
  }
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" onKeyDown={moveFocus}>
      <legend className={FILTER_LEGEND}>{legend}</legend>
      <details
        ref={details}
        className="relative"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="flex h-11 cursor-pointer list-none items-center rounded-[10px] border border-canopy-700/25 bg-white px-3.5 text-body text-canopy-950">
          {value.length === 0 ? none : some(value.length)}
        </summary>
        <div
          className={`absolute ${align} z-10 mt-1 flex max-h-80 w-max max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-[10px] border border-canopy-700/15 bg-white px-3.5 py-1 shadow-sm`}
        >
          {find ? (
            <input
              ref={findBox}
              type="search"
              aria-label={find}
              placeholder="Type to find"
              className="sticky top-0 z-10 my-1.5 h-10 rounded-[8px] border border-canopy-700/25 bg-white px-3 text-body text-canopy-950"
              value={text}
              onChange={(event) => setText(event.target.value)}
              // Enter only filters; it never submits the search form.
              onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
            />
          ) : null}
          {shown.map((option, i) => (
            <Fragment key={option.value}>
              {option.group && option.group !== shown[i - 1]?.group ? (
                <p className={`${FILTER_LEGEND} px-0 pt-2`}>{option.group}</p>
              ) : null}
              <label className="flex min-h-11 items-center gap-2.5 py-1 text-body text-canopy-900">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-canopy-700"
                  checked={value.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      options
                        .map((o) => o.value)
                        .filter((v) =>
                          v === option.value ? event.target.checked : value.includes(v),
                        ),
                    )
                  }
                />
                {option.label}
              </label>
            </Fragment>
          ))}
        </div>
      </details>
      {error ? <p className="text-meta text-red-700">{error}</p> : null}
    </fieldset>
  );
}
