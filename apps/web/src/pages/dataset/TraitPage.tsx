import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TraitDetail, TraitSpeciesMode } from '@treerepro/contracts';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { datasetKeys, fetchTrait, fetchTraitSpecies } from '../../api/dataset.ts';
import { mapAlt, mapsByTrait, useMaps } from '../../api/maps.ts';
import { Pagination } from '../../components/dataset/Pagination.tsx';
import {
  TaxonomyFilters,
  type TaxonomyFiltersValue,
} from '../../components/dataset/TaxonomyFilters.tsx';
import { TraitSpeciesTable } from '../../components/dataset/TraitSpeciesTable.tsx';
import { MapFigure } from '../../components/maps/MapFigure.tsx';
import { useBreadcrumb } from '../../components/shell/Breadcrumb.tsx';
import { Alert, Badge, Chip, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { detailErrorMessage, pageErrorMessage } from '../../lib/errors.ts';
import {
  formatDateTime,
  formatNumber,
  humaniseKey,
  TRAIT_VALUE_TYPE_LABELS,
} from '../../lib/format.ts';
import { useDebouncedValue } from '../../lib/use-debounced-value.ts';
import { usePagedList } from '../../lib/use-paged-list.ts';

const DASH = <span className="text-mist-500">—</span>;
const NO_RECORDS = 'No harmonised records yet.';
const MODES: readonly TraitSpeciesMode[] = ['with', 'missing'];
const MODE_LABELS: Record<TraitSpeciesMode, string> = {
  with: 'Species with data',
  missing: 'Species missing data',
};
const TAB =
  'h-11 border-b-2 px-4 text-body font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';
const TAB_SELECTED = 'border-canopy-700 text-canopy-950';
const TAB_IDLE = 'border-transparent text-mist-500 hover:text-canopy-800';

/**
 * The trait page's own search params: which tab is open and the taxonomy
 * filters both tables share (RFC-62 R8).
 * @rfc RFC-62 R8
 */
export interface TraitSpeciesSearch {
  mode?: TraitSpeciesMode;
  q?: string;
  familyId?: string;
  genusId?: string;
}

function errorMessage(error: unknown): string {
  return detailErrorMessage(error, 'TRAIT_NOT_FOUND', 'This trait does not exist.');
}

// `12 species`, `1 species` — the noun does not change, the count does.
function species(n: number): string {
  return `${formatNumber(n)} species`;
}

// `19 records`, `1 record` — this one does inflect.
function records(n: number): string {
  return `${formatNumber(n)} record${n === 1 ? '' : 's'}`;
}

// Everything the filters put in the URL, in one comparable string.
function filtersKey(value: TaxonomyFiltersValue): string {
  return JSON.stringify([value.q.trim() || null, value.familyId ?? null, value.genusId ?? null]);
}

function Facts({ trait }: { trait: TraitDetail }) {
  const rows: ReadonlyArray<{ label: string; value: ReactNode }> = [
    {
      label: 'Category',
      value: (
        <Link
          to="/app/traits"
          search={{ categoryKey: trait.category.key }}
          className="font-medium text-canopy-900 underline-offset-2 hover:underline"
        >
          {trait.category.label}
        </Link>
      ),
    },
    { label: 'Unit', value: trait.unit ?? DASH },
    { label: 'Species with data', value: formatNumber(trait.speciesWithData) },
    { label: 'Species missing data', value: formatNumber(trait.speciesMissing) },
    { label: 'Species validated', value: formatNumber(trait.validatedCount) },
  ];
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-cell">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-mist-500">{row.label}</dt>
          <dd className="break-words text-canopy-950">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * How the trait's harmonised records fall: one chip per level for a
 * categorical trait, the numeric spread for a quantitative one. Both shapes
 * can be empty — a categorical trait with no harmonised record has no level
 * to show, a quantitative one answers `numeric: null` — and then the section
 * says so rather than printing zeros, and says nothing about when a summary
 * that does not exist was computed.
 */
function Distribution({ trait }: { trait: TraitDetail }) {
  const { distribution, unit } = trait;
  const counted =
    'levels' in distribution ? distribution.levels.length > 0 : distribution.numeric !== null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-section font-semibold text-canopy-950">Distribution</h2>
      {'levels' in distribution ? (
        distribution.levels.length > 0 ? (
          <ul aria-label="Level distribution" className="flex flex-wrap gap-2">
            {distribution.levels.map((entry) => (
              <li key={entry.level.id}>
                <Chip>
                  {humaniseKey(entry.level.key)}{' '}
                  <span className="ml-1.5 text-mist-500">
                    {species(entry.speciesCount)} · {records(entry.recordCount)}
                  </span>
                </Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-mist-500">{NO_RECORDS}</p>
        )
      ) : distribution.numeric !== null ? (
        <>
          <ul aria-label="Numeric distribution" className="flex flex-wrap gap-2">
            {[
              { label: 'min', value: distribution.numeric.min },
              { label: 'median', value: distribution.numeric.median },
              { label: 'max', value: distribution.numeric.max },
            ].map((figure) => (
              <li key={figure.label}>
                <Chip>
                  {figure.label}{' '}
                  <span className="ml-1.5 font-semibold">
                    {formatNumber(figure.value)}
                    {unit === null ? '' : ` ${unit}`}
                  </span>
                </Chip>
              </li>
            ))}
          </ul>
          <p className="text-meta text-mist-500">
            Across {species(distribution.numeric.speciesCount)} with harmonised records.
          </p>
        </>
      ) : (
        <p className="text-body text-mist-500">{NO_RECORDS}</p>
      )}
      {counted ? (
        <p className="text-meta text-mist-500">
          Counted at {formatDateTime(trait.computedAt)} UTC; the summary lags a few minutes behind
          the records.
        </p>
      ) : null}
    </section>
  );
}

/**
 * The trait's own maps (RFC-76 R8), when it has any: the completeness map as
 * a thumbnail (left out when the manifest has none for this trait) and a
 * link to the trait's full maps page. A trait with no maps visible to this
 * viewer renders nothing at all — not even the heading — and a failed
 * `useMaps` query reads the same as no maps.
 * @rfc RFC-76 R8
 */
function TraitMaps({ trait }: { trait: TraitDetail }) {
  const maps = useMaps();
  const entries = mapsByTrait(maps.data ?? []).get(trait.id) ?? [];
  if (entries.length === 0) return null;
  const completeness = entries.find((entry) => entry.kind === 'completeness');
  const name = humaniseKey(trait.key);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-section font-semibold text-canopy-950">Maps</h2>
      {completeness ? (
        <div className="max-w-sm">
          <MapFigure entry={completeness} alt={mapAlt('completeness', name)} size="thumb" />
        </div>
      ) : null}
      <Link
        to="/app/maps/$traitId"
        params={{ traitId: trait.id }}
        className="font-medium text-canopy-900 underline-offset-2 hover:underline"
      >
        See all maps for this trait →
      </Link>
    </section>
  );
}

/**
 * The species of the trait, tab by tab: the ones with a record for it and
 * the ones without (RFC-62 R8). The tabs and the taxonomy filters are search
 * params, so a tab and a family are a link; the name is written back on the
 * debounce boundary the request itself waits for, everything else at once,
 * and a search arriving from outside (the back button, a pasted URL) is
 * adopted wholesale — the pattern `SpeciesSearchPage` established. A name
 * shorter than the API's minimum of two letters is not sent. Every change of
 * a filter changes the query key, which starts the list over at page 1: a
 * cursor never crosses a change of mode, where it would be meaningless.
 */
function TraitSpecies({
  trait,
  search,
  onSearchChange,
}: {
  trait: TraitDetail;
  search: TraitSpeciesSearch;
  onSearchChange: (next: TraitSpeciesSearch) => void;
}) {
  const mode: TraitSpeciesMode = search.mode ?? 'with';
  const panelId = useId();
  const tabPrefix = useId();
  const tabId = (value: TraitSpeciesMode) => `${tabPrefix}-${value}`;

  const incoming: TaxonomyFiltersValue = {
    q: search.q ?? '',
    familyId: search.familyId,
    genusId: search.genusId,
  };
  const [form, setForm] = useState<TaxonomyFiltersValue>(incoming);
  const [seen, setSeen] = useState(() => filtersKey(incoming));
  const incomingKey = filtersKey(incoming);
  if (incomingKey !== seen) {
    // The URL moved under the page: adopt it during this render rather than
    // in an effect, so the form and the request never disagree for a frame.
    setSeen(incomingKey);
    setForm(incoming);
  }
  const term = useDebouncedValue(form.q.trim(), 300);
  // The debounce of the write itself: browsers rate-limit `replaceState`, and
  // the address bar is better off holding names that have stopped changing.
  const settled = term === form.q.trim();
  const formKey = filtersKey(form);
  useEffect(() => {
    if (!settled || formKey === seen) return;
    // Claim what is being written as already seen, so its own echo is not
    // mistaken for an outside change.
    setSeen(formKey);
    onSearchChange({
      mode: search.mode,
      q: form.q.trim() || undefined,
      familyId: form.familyId,
      genusId: form.genusId,
    });
  }, [settled, formKey, seen, form, search.mode, onSearchChange]);

  const params = {
    mode,
    q: term.length >= 2 ? term : undefined,
    familyId: form.familyId,
    genusId: form.genusId,
  };
  const list = usePagedList(datasetKeys.traitSpecies(trait.id, params), (cursor, limit) =>
    fetchTraitSpecies(trait.id, { ...params, cursor, limit }),
  );

  function select(next: TraitSpeciesMode) {
    // `with` is the API's default mode; leaving it off keeps the URL to what
    // actually narrows the page.
    onSearchChange({ ...search, mode: next === 'with' ? undefined : next });
  }

  return (
    <section className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Species of this trait"
        className="flex gap-1 border-b border-canopy-700/15"
      >
        {MODES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={tabId(value)}
            aria-selected={mode === value}
            aria-controls={panelId}
            tabIndex={mode === value ? 0 : -1}
            className={`${TAB} ${mode === value ? TAB_SELECTED : TAB_IDLE}`}
            onClick={() => select(value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              event.preventDefault();
              const next: TraitSpeciesMode = value === 'with' ? 'missing' : 'with';
              select(next);
              document.getElementById(tabId(next))?.focus();
            }}
          >
            {MODE_LABELS[value]}
          </button>
        ))}
      </div>
      {/* The panel holds focusable content of its own (the filters, the
          species links), so it is not made focusable itself. */}
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(mode)}
        className="flex flex-col gap-4"
      >
        <TaxonomyFilters value={form} onChange={setForm} />
        {list.error ? <Alert tone="error">{pageErrorMessage(list.error)}</Alert> : null}
        {list.isLoading && !list.error ? (
          <p className="text-body text-mist-500">Loading species…</p>
        ) : null}
        {!list.isLoading && !list.error && list.items.length === 0 ? (
          <EmptyState
            title={
              mode === 'with'
                ? 'No species have data for this trait yet.'
                : 'Every visible species has data for this trait.'
            }
          />
        ) : null}
        {list.items.length > 0 ? (
          <TraitSpeciesTable items={list.items} mode={mode} unit={trait.unit} />
        ) : null}
        {list.items.length > 0 || list.page > 1 ? <Pagination pager={list} /> : null}
      </div>
    </section>
  );
}

/**
 * One trait (RFC-62 R7): what it is — its category, unit, description, value
 * type and whether it is still active — how many species have data for it,
 * lack it or have a validated record, and how its harmonised records are
 * distributed. Below that, a Maps section (RFC-76 R8) when the trait has any,
 * then the species themselves, with data and without (RFC-62 R8), each tab a
 * paginated table narrowed by the taxonomy filters; a species with no record
 * yet links to its own page opened on the traits it is missing, which is
 * where the first entry is made. The species section mounts only once the
 * trait resolved, so an unknown id shows one alert and no empty tables. The
 * category and the trait's own name are registered as the shell's trailing
 * crumbs, so the breadcrumb reads `Data › Traits › <Category> › <trait>`
 * (RFC-13 R3).
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-62 R7, R8
 * @rfc RFC-76 R8
 */
export function TraitPage({
  id,
  search,
  onSearchChange,
}: {
  id: string;
  search: TraitSpeciesSearch;
  onSearchChange: (next: TraitSpeciesSearch) => void;
}) {
  const trait = useQuery({ queryKey: datasetKeys.trait(id), queryFn: () => fetchTrait(id) });
  const data = trait.data;
  useBreadcrumb(
    data
      ? [
          {
            label: data.category.label,
            to: '/app/traits',
            search: { categoryKey: data.category.key },
          },
          { label: humaniseKey(data.key) },
        ]
      : [],
  );

  if (trait.isPending) {
    return (
      <>
        <PageHeader title="Trait" />
        <p className="text-body text-mist-500">Loading…</p>
      </>
    );
  }
  if (trait.isError) {
    return (
      <>
        <PageHeader title="Trait" />
        <Alert tone="error">{errorMessage(trait.error)}</Alert>
      </>
    );
  }

  const loaded = trait.data;
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {humaniseKey(loaded.key)}
            <Badge tone="green">{TRAIT_VALUE_TYPE_LABELS[loaded.valueType]}</Badge>
            {loaded.active ? null : <Badge>inactive</Badge>}
          </span>
        }
        description={loaded.description}
      />
      <div className="flex flex-col gap-8">
        <Facts trait={loaded} />
        <Distribution trait={loaded} />
        <TraitMaps trait={loaded} />
        <TraitSpecies trait={loaded} search={search} onSearchChange={onSearchChange} />
      </div>
    </>
  );
}
