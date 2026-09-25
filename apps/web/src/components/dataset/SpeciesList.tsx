import { Link } from '@tanstack/react-router';
import type { NameType, SpeciesListItem } from '@treerepro/contracts';
import { formatNumber } from '../../lib/format.ts';
import { Badge, Chip, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

const DASH = <span className="text-mist-500">—</span>;

// The match badge's own short labels (RFC-60 R6): lower-case for synonym and
// common so the row reads as prose, "GBIF" capitalised as the provider's
// name is everywhere else. `SpeciesListItem` carries no language for the
// matched name (only the full `names[]` of the species detail does), so —
// unlike the species header's common-name chips — this badge never shows one.
const MATCH_TYPE_LABELS: Record<NameType, string> = {
  gbif: 'GBIF',
  synonym: 'synonym',
  common: 'common',
};

/**
 * Rows of a species search. The canonical name opens the species page; a
 * species the API flags as `unresolvedTaxon` is marked unresolved (RFC-60 R6)
 * — `null` for a viewer without `records.review`, so the API decides who sees
 * it, not the name source here — and, when the term matched an alternative
 * name instead of the canonical one, that name
 * is shown as "found as: *name*" with a small badge for its type (synonym /
 * common / GBIF) so the row explains why it is there. An inactive species
 * (only ever listed for a `dataset.read_inactive` holder) is flagged beside
 * the name. **Traits** is the coverage count (RFC-69 R1): how many traits
 * the species has at least one record for, the number "Most incomplete
 * first" orders by. **Records** is the record count for the one filtered
 * trait, so it only makes sense while a trait filter is set —
 * `showTraitRecords` adds the column, and a row whose `traitRecordCount` is
 * null (no trait filter reached the API) reads as a dash.
 * @rfc RFC-13 R2
 * @rfc RFC-60 R4, R6
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
                {species.unresolvedTaxon === true ? <Badge tone="amber">unresolved</Badge> : null}
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
              {species.matchedName ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    found as: <em>{species.matchedName}</em>
                  </span>
                  {species.matchedNameType ? (
                    <Chip>{MATCH_TYPE_LABELS[species.matchedNameType]}</Chip>
                  ) : null}
                </span>
              ) : (
                DASH
              )}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
