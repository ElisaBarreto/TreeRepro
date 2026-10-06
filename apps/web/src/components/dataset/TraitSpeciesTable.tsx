import { Link } from '@tanstack/react-router';
import type { TraitSpeciesItem, TraitSpeciesMode } from '@treerepro/contracts';
import { fieldMeansText, formatNumber, humaniseKey } from '../../lib/format.ts';
import { Badge, ButtonLink, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

const DASH = <span className="text-mist-500">—</span>;
const LINK = 'font-medium italic text-canopy-900 underline-offset-2 hover:underline';

// The species' own records on this trait: one line of the levels it has
// values on with their counts, or one line per unit of the mean of each of
// its value fields, each value in its own unit.
function summaryLines(item: TraitSpeciesItem): string[] {
  if (item.summary === null) return [];
  if ('levels' in item.summary) {
    return [
      item.summary.levels
        .map((level) => `${humaniseKey(level.key)} ${formatNumber(level.count)}`)
        .join(' · '),
    ];
  }
  return item.summary.numeric.map((entry) => fieldMeansText(entry.means, entry.unit));
}

/**
 * The species of one trait, one page at a time (RFC-62 R8). In `with` mode a
 * row carries how many records the species has on the trait and a one-line
 * summary of them. In `missing` mode there is nothing to count, so the row
 * offers the way to change that instead: the species page opened on the
 * traits it has no record for (RFC-70 R7).
 * @rfc RFC-13 R2
 * @rfc RFC-62 R8
 */
export function TraitSpeciesTable({
  items,
  mode,
}: {
  items: TraitSpeciesItem[];
  mode: TraitSpeciesMode;
}) {
  const withData = mode === 'with';
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Species</Th>
          <Th>Family</Th>
          {withData ? (
            <Th>Records</Th>
          ) : (
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          )}
        </Tr>
      </Thead>
      <Tbody>
        {items.map((item) => {
          const summary = summaryLines(item);
          return (
            <Tr key={item.id}>
              <Td>
                <span className="flex flex-wrap items-center gap-2">
                  <Link to="/app/species/$id" params={{ id: item.id }} className={LINK}>
                    {item.canonicalName}
                  </Link>
                  {item.active ? null : <Badge>inactive</Badge>}
                </span>
              </Td>
              <Td>{item.family?.name ?? DASH}</Td>
              {withData ? (
                <Td>
                  {/* The count and the summary are nullable on their own
                      (RFC-62 R8), so neither hides the other: a row can
                      summarise records it has no count for. */}
                  <span className="flex flex-col gap-0.5">
                    <span>{item.recordCount === null ? DASH : formatNumber(item.recordCount)}</span>
                    {summary.map((line) => (
                      <span key={line} className="text-meta text-mist-500">
                        {line}
                      </span>
                    ))}
                  </span>
                </Td>
              ) : (
                <Td className="whitespace-nowrap">
                  <ButtonLink
                    to="/app/species/$id"
                    params={{ id: item.id }}
                    search={{ missing: true }}
                    size="sm"
                  >
                    Add the first entry
                  </ButtonLink>
                </Td>
              )}
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
