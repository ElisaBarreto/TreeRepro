import { Link } from '@tanstack/react-router';
import type { Coverage } from '@treerepro/contracts';
import { useState } from 'react';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { EmptyState, Icon, Meter, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

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
 * @rfc RFC-69 R5
 * @rfc RFC-13 R2
 */
export function CoverageTable({
  byCategory,
  byTrait,
}: {
  byCategory: Coverage['byCategory'];
  byTrait: Coverage['byTrait'];
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
          />
        ))}
      </Tbody>
    </Table>
  );
}

function CategoryRows({
  category,
  traits,
}: {
  category: Coverage['byCategory'][number];
  traits: Coverage['byTrait'];
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
      {open ? traits.map((trait) => <TraitRow key={trait.trait.id} trait={trait} />) : null}
    </>
  );
}

function TraitRow({ trait }: { trait: Coverage['byTrait'][number] }) {
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
            search={{ traitId: trait.trait.id, traitData: 'missing' }}
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
