import { Link } from '@tanstack/react-router';
import type { Coverage } from '@treerepro/contracts';
import { useState } from 'react';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { useMe } from '../../lib/session.ts';
import { EmptyState, Icon, Meter, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';
import type { CoverageSearch } from './CoverageFilters.tsx';

const CHEVRON_BUTTON =
  'flex size-8 items-center justify-center rounded-full text-canopy-700 transition-transform hover:bg-mist-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500 aria-expanded:rotate-90';

/**
 * The coverage grid by category, each row's chevron expanding to the
 * category's own trait rows (spec §5): a category row carries its trait
 * count, cells and two meters; a trait row carries the species with data
 * out of the selection, its own two meters, a link to its trait page and a
 * link into the species list scoped to it and `traitData=missing`. A trait
 * with no record anywhere in the selection reads "No record yet" rather
 * than "0 of N species" — literally true, since a withdrawn record still
 * counts as a record here (RFC-69 R2), so a zero means none exists at all.
 *
 * `search` is the page's own filter state, carried into those species links
 * by {@link missingSpeciesSearch} so the list a row opens honours the same
 * family/category/plot filters the row was computed over. For a
 * plot-restricted viewer with no plot filter, that list narrows further, to
 * their own plots — see {@link missingSpeciesSearch} for why.
 * @rfc RFC-69 R5
 * @rfc RFC-13 R2
 */
export function CoverageTable({
  byCategory,
  byTrait,
  search,
}: {
  byCategory: Coverage['byCategory'];
  byTrait: Coverage['byTrait'];
  search: CoverageSearch;
}) {
  const me = useMe();
  if (byCategory.length === 0) {
    return (
      <EmptyState
        title="No record yet."
        description="No visible species or trait matches this filter."
      />
    );
  }
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <span className="sr-only">Expand</span>
          </Th>
          <Th>Category / trait</Th>
          <Th>Cells</Th>
          <Th>With data</Th>
          <Th>Accepted</Th>
        </Tr>
      </Thead>
      <Tbody>
        {byCategory.map((category) => (
          <CategoryRows
            key={category.category.key}
            category={category}
            traits={byTrait.filter((trait) => trait.category.key === category.category.key)}
            search={search}
            restricted={me.scope.restricted}
          />
        ))}
      </Tbody>
    </Table>
  );
}

function CategoryRows({
  category,
  traits,
  search,
  restricted,
}: {
  category: Coverage['byCategory'][number];
  traits: Coverage['byTrait'];
  search: CoverageSearch;
  restricted: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tr>
        <Td>
          <button
            type="button"
            aria-expanded={open}
            aria-label={
              open ? `Collapse ${category.category.label}` : `Expand ${category.category.label}`
            }
            className={CHEVRON_BUTTON}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </Td>
        <Td className="font-medium text-canopy-950">
          {category.category.label}
          <span className="ml-2 text-meta font-normal text-mist-500">
            {formatNumber(category.traits)} traits
          </span>
        </Td>
        <Td className="tabular-nums">{formatNumber(category.cells)}</Td>
        <Td className="min-w-[10rem]">
          <Meter
            value={category.withData}
            max={category.cells}
            percent={category.percentWithData}
            label={`${category.category.label} species × trait cells with data`}
          />
        </Td>
        <Td className="min-w-[10rem]">
          <Meter
            value={category.accepted}
            max={category.cells}
            percent={category.percentAccepted}
            label={`${category.category.label} species × trait cells with an accepted value`}
          />
        </Td>
      </Tr>
      {open
        ? traits.map((trait) => (
            <TraitRow key={trait.trait.id} trait={trait} search={search} restricted={restricted} />
          ))
        : null}
    </>
  );
}

/**
 * The search the row's missing-species link carries: the trait and
 * `traitData=missing`, plus the page's own filters, so the list opens over
 * the same selection the row was computed over rather than over every
 * species.
 *
 * The coverage row itself is always dataset-wide (RFC-69 R6): a
 * plot-restricted viewer is barred from trait data for species outside their
 * plots, not from aggregate statistics about them, and a count is exactly
 * that — a species total, a completeness percentage, nothing about any one
 * species' traits. The drill-down list is different: it hands the viewer
 * actual species rows, which for a restricted viewer must stop at their own
 * plots. With a `plotId` filter the row is already that plot's, and
 * `plotId` scopes the list on its own (`scope` is ignored beside it,
 * RFC-33 R6). Without one, an unrestricted viewer gets `scope=all` so the
 * list matches the dataset-wide row they clicked; a restricted viewer
 * instead gets no `scope` at all, so `GET /api/species` falls back to its
 * own default for them, `scope=plots` (RFC-33 R6) — the species in their own
 * plots missing this trait, which is what they can actually act on, rather
 * than the `PERMISSION_DENIED` a bare `scope=all` would draw.
 */
function missingSpeciesSearch(traitId: string, search: CoverageSearch, restricted: boolean) {
  const base = {
    traitId,
    traitData: 'missing',
    familyId: search.familyId,
    categoryKey: search.categoryKey,
  } as const;
  if (search.plotId) return { ...base, plotId: search.plotId };
  return restricted ? base : { ...base, scope: 'all' as const };
}

function TraitRow({
  trait,
  search,
  restricted,
}: {
  trait: Coverage['byTrait'][number];
  search: CoverageSearch;
  restricted: boolean;
}) {
  const name = humaniseKey(trait.trait.key);
  // The label follows the link's own target (see `missingSpeciesSearch`):
  // only the unfiltered, restricted case opens the viewer's own plots rather
  // than the dataset-wide list the row counts.
  const missingLabel =
    restricted && !search.plotId
      ? 'Species in your plots with no record yet'
      : 'Species with no record yet';
  return (
    <Tr className="bg-mist-50">
      <Td />
      <Td>
        <div className="flex flex-col gap-1 pl-6">
          <span>
            <Link
              to="/app/traits/$id"
              params={{ id: trait.trait.id }}
              className="font-medium text-canopy-900 underline-offset-2 hover:underline"
            >
              {name}
            </Link>
            {trait.trait.unit ? <span className="text-mist-500"> · {trait.trait.unit}</span> : null}
          </span>
          <Link
            to="/app/species"
            search={missingSpeciesSearch(trait.trait.id, search, restricted)}
            className="text-meta font-medium text-canopy-700 underline-offset-2 hover:underline"
          >
            {missingLabel}
          </Link>
        </div>
      </Td>
      <Td className="tabular-nums">
        {trait.withData === 0 ? (
          <span className="text-mist-500">No record yet</span>
        ) : (
          `${formatNumber(trait.species)} of ${formatNumber(trait.cells)} species`
        )}
      </Td>
      <Td className="min-w-[10rem]">
        <Meter
          value={trait.withData}
          max={trait.cells}
          percent={trait.percentWithData}
          label={`${name} species with data`}
        />
      </Td>
      <Td className="min-w-[10rem]">
        <Meter
          value={trait.accepted}
          max={trait.cells}
          percent={trait.percentAccepted}
          label={`${name} species with an accepted value`}
        />
      </Td>
    </Tr>
  );
}
