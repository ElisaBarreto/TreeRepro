import { Link } from '@tanstack/react-router';
import type {
  SortOrder,
  TraitSpeciesItem,
  TraitSpeciesMode,
  TraitSpeciesSort,
} from '@treerepro/contracts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { Badge, ButtonLink, SortTh, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';
import { medianLine, spreadLine } from './TraitCard.tsx';

const DASH = <span className="text-mist-500">—</span>;
const LINK = 'font-medium italic text-canopy-900 underline-offset-2 hover:underline';

// The species' own records on this trait: one line of the levels it has
// values on with their counts, or its RFC-77 summary — the median, then the
// mean, range, records and sources — as the species page's card reads it.
function summaryLines(item: TraitSpeciesItem): string[] {
  if (item.summary === null) return [];
  if ('levels' in item.summary) {
    return [
      item.summary.levels
        .map((level) => `${humaniseKey(level.key)} ${formatNumber(level.count)}`)
        .join(' · '),
    ];
  }
  const median = medianLine(item.summary.continuous);
  return [...(median ? [median] : []), spreadLine(item.summary.continuous)];
}

/**
 * The species of one trait, one page at a time (RFC-62 R8). In `with` mode a
 * row carries how many records the species has on the trait and a one-line
 * summary of them. In `missing` mode there is nothing to count, so the row
 * offers the way to change that instead: the species page opened on the
 * traits it has no record for (RFC-70 R7). With `onOpenRecords`, a non-zero
 * record count is a button that hands the row back, so the page can open the
 * species' records on the trait (issue #311). With `sort`, the Species and
 * Family headers — and Records, in `with` mode — are sort buttons (RFC-62 R8).
 * @rfc RFC-13 R2
 * @rfc RFC-62 R8
 */
export function TraitSpeciesTable({
  items,
  mode,
  onOpenRecords,
  sort,
}: {
  items: TraitSpeciesItem[];
  mode: TraitSpeciesMode;
  onOpenRecords?: (item: TraitSpeciesItem) => void;
  sort?: { by: TraitSpeciesSort; order: SortOrder; onSort: (by: TraitSpeciesSort) => void };
}) {
  const withData = mode === 'with';
  const head = (by: TraitSpeciesSort, label: string) =>
    sort ? (
      <SortTh
        label={label}
        direction={sort.by === by ? sort.order : null}
        onSort={() => sort.onSort(by)}
      />
    ) : (
      <Th>{label}</Th>
    );
  return (
    <Table>
      <Thead>
        <Tr>
          {head('name', 'Species')}
          {head('family', 'Family')}
          {withData ? (
            head('records', 'Records')
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
                    {item.recordCount === null ? (
                      DASH
                    ) : onOpenRecords && item.recordCount > 0 ? (
                      <button
                        type="button"
                        aria-label={`See the ${formatNumber(item.recordCount)} records of ${item.canonicalName}`}
                        className="self-start font-medium text-canopy-900 underline underline-offset-2 hover:text-canopy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                        onClick={() => onOpenRecords(item)}
                      >
                        {formatNumber(item.recordCount)}
                      </button>
                    ) : (
                      <span>{formatNumber(item.recordCount)}</span>
                    )}
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
