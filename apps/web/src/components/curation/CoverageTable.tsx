import { Link } from '@tanstack/react-router';
import type { Coverage } from '@treerepro/contracts';
import { useState } from 'react';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
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
 * by {@link missingSpeciesSearch} so the list a row opens counts the species
 * the row counted.
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
}: {
  category: Coverage['byCategory'][number];
  traits: Coverage['byTrait'];
  search: CoverageSearch;
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
        ? traits.map((trait) => <TraitRow key={trait.trait.id} trait={trait} search={search} />)
        : null}
    </>
  );
}

/**
 * The search the row's "Species with no record yet" link carries: the trait
 * and `traitData=missing`, plus the page's own filters, so the list opens over
 * the same selection the row was computed over rather than over every species.
 *
 * `scope` is named rather than left to default, for the same reason
 * `MissingTraitsList` names it. The coverage grid is plot-agnostic unless a
 * `plotId` filter is given (RFC-69 R6), so the row is a dataset-wide number
 * and its link must ask for the dataset-wide list — while `GET /api/species`
 * defaults a viewer with assigned plots to `scope=plots` (RFC-33 R6), which
 * would answer a smaller number than the row the viewer clicked. With a
 * `plotId` filter the row is that plot's, and `plotId` scopes the list on its
 * own (`scope` is ignored beside it, RFC-33 R6). A plot-bound viewer is
 * refused `scope=all` and reads RFC-13 R4's message instead: their coverage
 * row is dataset-wide and no species list they may open matches it, so an
 * honest refusal beats a number that silently disagrees.
 */
function missingSpeciesSearch(traitId: string, search: CoverageSearch) {
  const base = {
    traitId,
    traitData: 'missing',
    familyId: search.familyId,
    categoryKey: search.categoryKey,
  } as const;
  return search.plotId ? { ...base, plotId: search.plotId } : { ...base, scope: 'all' as const };
}

function TraitRow({
  trait,
  search,
}: {
  trait: Coverage['byTrait'][number];
  search: CoverageSearch;
}) {
  const name = humaniseKey(trait.trait.key);
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
            search={missingSpeciesSearch(trait.trait.id, search)}
            className="text-meta font-medium text-canopy-700 underline-offset-2 hover:underline"
          >
            Species with no record yet
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
