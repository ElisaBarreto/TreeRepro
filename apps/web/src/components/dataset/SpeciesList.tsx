import { Link } from '@tanstack/react-router';
import type { SpeciesListItem } from '@treerepro/contracts';
import { formatNumber } from '../../lib/format.ts';
import { Badge, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

const DASH = <span className="text-mist-500">—</span>;

/**
 * Rows of a species search. The canonical name opens the species page; a
 * name that is not WCVP's is flagged as unresolved (RFC-60 R3) and, when the
 * term matched an alternative name instead of the canonical one, that name
 * is shown so the row explains why it is there. An inactive species (only
 * ever listed for a `dataset.read_inactive` holder) is flagged beside the
 * name. **Traits** is the coverage count (RFC-69 R1): how many traits the
 * species has at least one record for, the number "Most incomplete first"
 * orders by. **Records** is the record count for the one filtered trait, so
 * it only makes sense while a trait filter is set — `showTraitRecords` adds
 * the column, and a row whose `traitRecordCount` is null (no trait filter
 * reached the API) reads as a dash.
 * @rfc RFC-13 R2
 * @rfc RFC-60 R6
 * @rfc RFC-33 R7
 */
export function SpeciesList({
  items,
  showTraitRecords = false,
}: {
  items: SpeciesListItem[];
  showTraitRecords?: boolean;
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Species</Th>
          <Th>Family</Th>
          <Th>Genus</Th>
          <Th>Traits</Th>
          {showTraitRecords ? <Th>Records</Th> : null}
          <Th>Match</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((species) => (
          <Tr key={species.id}>
            <Td>
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  to="/app/species/$id"
                  params={{ id: species.id }}
                  className="font-medium italic text-canopy-900 underline-offset-2 hover:underline"
                >
                  {species.canonicalName}
                </Link>
                {species.nameSource !== 'wcvp' ? <Badge tone="amber">unresolved</Badge> : null}
                {species.active ? null : <Badge tone="neutral">inactive</Badge>}
              </span>
            </Td>
            <Td>{species.family?.name ?? DASH}</Td>
            <Td>{species.genus?.name ?? DASH}</Td>
            <Td>{formatNumber(species.traitCount)}</Td>
            {showTraitRecords ? (
              <Td>
                {species.traitRecordCount === null ? DASH : formatNumber(species.traitRecordCount)}
              </Td>
            ) : null}
            <Td className="text-mist-500">
              {species.matchedName ? `matched: ${species.matchedName}` : DASH}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
