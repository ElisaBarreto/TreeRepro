import { useQuery } from '@tanstack/react-query';
import type { PhylogenyFigure, Trait } from '@treerepro/contracts';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { datasetKeys, fetchDictionary } from '../../api/dataset.ts';
import { figureUrl, phylogenyByTrait, usePhylogenies } from '../../api/phylogenies.ts';
import { notAvailableYet } from '../../components/phylogenies/not-available.ts';
import { PhylogenyViewer } from '../../components/phylogenies/PhylogenyViewer.tsx';
import { Alert, ButtonLink, EmptyState, PageHeader } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { humaniseKey } from '../../lib/format.ts';

/** The page's search params: a category key and a trait key. @rfc RFC-79 R6 */
export interface PhylogeniesSearch {
  category?: string;
  trait?: string;
}

// The Maps page's tab and toggle looks (`MapsPage.tsx`).
const TAB =
  'h-11 shrink-0 whitespace-nowrap border-b-2 px-4 text-body font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';
const TAB_SELECTED = 'border-canopy-700 text-canopy-950';
const TAB_IDLE = 'border-transparent text-mist-500 hover:text-canopy-800';
const TOGGLE_BUTTON =
  'rounded-full border border-canopy-700/25 px-3.5 py-1.5 text-meta font-semibold text-canopy-900 transition-colors hover:bg-mist-100 aria-pressed:border-transparent aria-pressed:bg-canopy-900 aria-pressed:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';

const ALL = '';
const tabId = (key: string) => `phylo-tab-${key || 'all'}`;
const traitButtonId = (key: string) => `phylo-trait-${key}`;

/** Left/Right (and Up/Down for buttons) move, wrapping; Home/End on tabs. */
function moveIndex(key: string, index: number, count: number, vertical: boolean) {
  if (key === 'ArrowRight' || (vertical && key === 'ArrowDown')) return (index + 1) % count;
  if (key === 'ArrowLeft' || (vertical && key === 'ArrowUp')) return (index - 1 + count) % count;
  if (!vertical && key === 'Home') return 0;
  if (!vertical && key === 'End') return count - 1;
  return undefined;
}

/**
 * `/app/phylogenies`: an **All traits** tab with the coverage figure (the
 * default), then one tab per dictionary category with figures, its traits as
 * buttons and the selected trait's figure. `?trait=` alone selects its
 * category; an unknown key falls back to All traits. Clicking a figure opens
 * the zoomable viewer over the tab's figures.
 * @rfc RFC-79 R6
 */
export function PhylogeniesPage({
  search,
  onSearchChange,
}: {
  search: PhylogeniesSearch;
  onSearchChange: (next: PhylogeniesSearch) => void;
}) {
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  const figures = usePhylogenies();
  const [open, setOpen] = useState<number | null>(null);
  const byTrait = phylogenyByTrait(figures.data ?? []);
  const coverage = figures.data?.find((f) => f.traitId === null);
  const categories = (dictionary.data ?? [])
    .map((c) => ({ ...c, traits: c.traits.filter((t) => byTrait.has(t.id)) }))
    .filter((c) => c.traits.length > 0);
  const category =
    categories.find((c) => c.traits.some((t) => t.key === search.trait)) ??
    (search.trait ? undefined : categories.find((c) => c.key === search.category));
  const selected =
    category && (category.traits.find((t) => t.key === search.trait) ?? category.traits[0]);
  const tabs = [...(coverage ? [{ key: ALL, label: 'All traits' }] : []), ...categories];
  const current = category?.key ?? (coverage ? ALL : categories[0]?.key);
  const shownCategory = categories.find((c) => c.key === current);
  const trait = selected ?? shownCategory?.traits[0];

  const error = dictionary.error ?? figures.error;
  const isPending = dictionary.isPending || figures.isPending;
  const loaded = dictionary.isSuccess && figures.isSuccess;
  const empty = loaded && tabs.length === 0;

  // The viewer steps through the shown tab's figures only.
  const items = shownCategory
    ? shownCategory.traits.map((t) => ({
        figure: byTrait.get(t.id) as PhylogenyFigure,
        heading: humaniseKey(t.key),
      }))
    : coverage
      ? [{ figure: coverage, heading: 'All traits' }]
      : [];

  function selectTab(key: string) {
    setOpen(null);
    onSearchChange(key === ALL ? {} : { category: key, trait: undefined });
  }

  function onTabKeyDown(event: KeyboardEvent, index: number) {
    const next = moveIndex(event.key, index, tabs.length, false);
    const target = next === undefined ? undefined : tabs[next];
    if (!target) return;
    event.preventDefault();
    selectTab(target.key);
    document.getElementById(tabId(target.key))?.focus();
  }

  return (
    <>
      <PageHeader
        title="Phylogenies"
        description="Trait values at the tips of the phylogeny. Start with the coverage of all traits, or choose a category, then a trait."
      />
      {error ? <Alert tone="error">{pageErrorMessage(error)}</Alert> : null}
      {isPending ? <p className="text-body text-mist-500">Loading…</p> : null}
      {empty ? <EmptyState title={notAvailableYet()} /> : null}
      {loaded && tabs.length > 0 && current !== undefined ? (
        <>
          <div
            role="tablist"
            aria-label="Trait categories"
            className="mb-6 flex gap-1 overflow-x-auto border-b border-canopy-700/15"
          >
            {tabs.map((t, index) => (
              <button
                key={t.key || 'all'}
                type="button"
                role="tab"
                id={tabId(t.key)}
                aria-selected={t.key === current}
                aria-controls="phylo-panel"
                tabIndex={t.key === current ? 0 : -1}
                className={`${TAB} ${t.key === current ? TAB_SELECTED : TAB_IDLE}`}
                onClick={() => selectTab(t.key)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id="phylo-panel"
            aria-labelledby={tabId(current)}
            className="flex flex-col gap-6"
          >
            {shownCategory && trait ? (
              <>
                <TraitButtons
                  categoryLabel={shownCategory.label}
                  traits={shownCategory.traits}
                  selected={trait}
                  onSelect={(key) => onSearchChange({ category: shownCategory.key, trait: key })}
                />
                <Figure
                  heading={humaniseKey(trait.key)}
                  figure={byTrait.get(trait.id) as PhylogenyFigure}
                  onOpen={() => setOpen(shownCategory.traits.indexOf(trait))}
                  action={
                    <ButtonLink to="/app/traits/$id" params={{ id: trait.id }} size="sm">
                      Trait details
                    </ButtonLink>
                  }
                />
              </>
            ) : coverage ? (
              <Figure
                heading="Data coverage across all traits"
                figure={coverage}
                onOpen={() => setOpen(0)}
              />
            ) : null}
          </div>
          <PhylogenyViewer
            items={items}
            index={open}
            onIndexChange={(i) => {
              setOpen(i);
              const t = shownCategory?.traits[i];
              if (t) onSearchChange({ category: shownCategory.key, trait: t.key });
            }}
            onClose={() => setOpen(null)}
          />
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
    const next = moveIndex(event.key, index, traits.length, true);
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

/**
 * One figure from its display copy, under its heading; a click opens the
 * full-size viewer. Shared with the trait page (RFC-79 R7).
 * @rfc RFC-79 R6, R7
 */
export function Figure({
  heading,
  figure,
  onOpen,
  action,
  headingLevel = 'h3',
}: {
  heading: string;
  figure: PhylogenyFigure;
  onOpen: () => void;
  action?: ReactNode;
  headingLevel?: 'h3' | 'h4';
}) {
  const Heading = headingLevel;
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-canopy-700/10 bg-white p-4 shadow-sm sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Heading className="font-display text-section font-semibold text-canopy-950">
          {heading}
        </Heading>
        {action}
      </header>
      <button
        type="button"
        aria-label={`Open the ${heading} phylogeny at full size`}
        onClick={onOpen}
        className="cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
      >
        <img
          src={figureUrl(figure, 'display')}
          alt={`Phylogeny: ${heading}`}
          loading="lazy"
          className="h-auto w-full"
        />
      </button>
    </article>
  );
}
