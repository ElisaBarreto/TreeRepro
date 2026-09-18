import { Link } from '@tanstack/react-router';
import type { TraitSpeciesItem, TraitSpeciesMode } from '@treerepro/contracts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { referenceLabel } from '../../lib/references.ts';
import { Badge, ButtonLink, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

const DASH = <span className="text-mist-500">—</span>;
const LINK = 'font-medium italic text-canopy-900 underline-offset-2 hover:underline';

// The species' own records on this trait in one line: the levels it has
// values on with their counts, or the span its numbers cover.
function summaryText(item: TraitSpeciesItem, unit: string | null): string | null {
  if (item.summary === null) return null;
  if ('levels' in item.summary) {
    return item.summary.levels
      .map((level) => `${humaniseKey(level.key)} ${formatNumber(level.count)}`)
      .join(' · ');
  }
  const { min, max } = item.summary.numeric;
  const span = `${formatNumber(min)} – ${formatNumber(max)}`;
  return unit === null ? span : `${span} ${unit}`;
}

/**
 * The species of one trait, one page at a time (RFC-62 R8). In `with` mode a
 * row carries how many records the species has on the trait, a one-line
 * summary of them, the value a curator accepted and the article it came from
 * — each of the last two a dash while nothing has been accepted. In
 * `missing` mode there is nothing to count, so the row offers the way to
 * change that instead: the species page opened on the traits it has no
 * record for (RFC-70 R7).
 * @rfc RFC-13 R2
 * @rfc RFC-62 R8
 */
export function TraitSpeciesTable({
  items,
  mode,
  unit,
}: {
  items: TraitSpeciesItem[];
  mode: TraitSpeciesMode;
  /** The trait's unit, for the numeric summaries that carry one. */
  unit: string | null;
}) {
  const withData = mode === 'with';
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Species</Th>
          <Th>Family</Th>
          {withData ? (
            <>
              <Th>Records</Th>
              <Th>Accepted value</Th>
              <Th>Source</Th>
            </>
          ) : (
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          )}
        </Tr>
      </Thead>
      <Tbody>
        {items.map((item) => {
          const summary = summaryText(item, unit);
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
                <>
                  <Td>
                    {item.recordCount === null ? (
                      DASH
                    ) : (
                      <span className="flex flex-col gap-0.5">
                        <span>{formatNumber(item.recordCount)}</span>
                        {summary ? (
                          <span className="text-meta text-mist-500">{summary}</span>
                        ) : null}
                      </span>
                    )}
                  </Td>
                  <Td className="text-canopy-800">{item.accepted?.valueText ?? DASH}</Td>
                  <Td>
                    {item.accepted ? (
                      <Link
                        to="/app/references/$id"
                        params={{ id: item.accepted.reference.id }}
                        className="font-medium text-canopy-900 underline-offset-2 hover:underline"
                      >
                        {referenceLabel(item.accepted.reference)}
                      </Link>
                    ) : (
                      DASH
                    )}
                  </Td>
                </>
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
