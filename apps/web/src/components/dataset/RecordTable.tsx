import { Link } from '@tanstack/react-router';
import type { RecordItem } from '@treerepro/contracts';
import { formatNumber, humaniseKey, isoDate, truncate } from '../../lib/format.ts';
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';
import { HarmonisationBadge } from './HarmonisationBadge.tsx';
import { ReviewBadge } from './ReviewBadge.tsx';

const REFERENCES_MAX = 80;

// The harmonised value when there is one, else the text as it was entered.
function valueLabel(record: RecordItem): string {
  if (record.level) return record.level.key;
  if (record.numericValue !== null) {
    const unit = record.trait.unit ? ` ${record.trait.unit}` : '';
    return `${formatNumber(record.numericValue)}${unit}`;
  }
  return record.valueText || '(empty)';
}

// The primary citation key, "via" the secondary one when the claim reached
// the primary through another source; the same reference in both roles is
// named once.
function referencesLabel(record: RecordItem): string {
  const { primaryReference: primary, secondaryReference: secondary } = record;
  return [
    primary?.citationKey,
    secondary && secondary.id !== primary?.id ? `via ${secondary.citationKey}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

/**
 * Records as rows: value, references (primary, "via" the secondary), origin,
 * the two status chips and the date added. The value is a button that
 * selects the row, so every record is reachable by keyboard. Outside a
 * species page (`showSpecies`) a first column names each row's species and
 * links to it; outside a trait panel (`showTrait`) a column names the trait,
 * so a row reads on its own.
 * @rfc RFC-63 R8
 */
export function RecordTable({
  records,
  onSelect,
  showSpecies = false,
  showTrait = false,
}: {
  records: RecordItem[];
  onSelect: (record: RecordItem) => void;
  showSpecies?: boolean;
  showTrait?: boolean;
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          {showSpecies ? <Th>Species</Th> : null}
          {showTrait ? <Th>Trait</Th> : null}
          <Th>Value</Th>
          <Th>References</Th>
          <Th>Origin</Th>
          <Th>Harmonisation</Th>
          <Th>Review</Th>
          <Th>Added</Th>
        </Tr>
      </Thead>
      <Tbody>
        {records.map((record) => {
          const value = valueLabel(record);
          const references = referencesLabel(record);
          const shown = truncate(references, REFERENCES_MAX);
          return (
            <Tr key={record.id} className="transition-colors hover:bg-mist-50">
              {showSpecies ? (
                <Td>
                  <Link
                    to="/app/species/$id"
                    params={{ id: record.species.id }}
                    className="font-medium italic text-canopy-900 underline-offset-2 hover:underline"
                  >
                    {record.species.canonicalName}
                  </Link>
                </Td>
              ) : null}
              {showTrait ? <Td>{humaniseKey(record.trait.key)}</Td> : null}
              <Td>
                <button
                  type="button"
                  onClick={() => onSelect(record)}
                  className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                >
                  {value}
                </button>
              </Td>
              <Td title={shown === references ? undefined : references}>{shown}</Td>
              <Td>{record.origin}</Td>
              <Td>
                <HarmonisationBadge status={record.harmonisation} />
              </Td>
              <Td>
                <ReviewBadge status={record.review} />
              </Td>
              <Td className="whitespace-nowrap tabular-nums">
                <time dateTime={record.createdAt}>{isoDate(record.createdAt)}</time>
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
