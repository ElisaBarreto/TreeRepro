import type { RecordItem } from '@treerepro/contracts';
import { formatNumber, isoDate, truncate } from '../../lib/format.ts';
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

function referencesLabel(record: RecordItem): string {
  return [
    record.primaryReference?.citationKey,
    record.secondaryReference ? `via ${record.secondaryReference.citationKey}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

/**
 * Records as rows: value, references (primary, "via" the secondary), origin,
 * the two status chips and the date added. The value is a button that
 * selects the row, so every record is reachable by keyboard.
 * @rfc RFC-63 R8
 */
export function RecordTable({
  records,
  onSelect,
}: {
  records: RecordItem[];
  onSelect: (record: RecordItem) => void;
}) {
  return (
    <Table>
      <Thead>
        <Tr>
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
          const references = referencesLabel(record);
          const shown = truncate(references, REFERENCES_MAX);
          return (
            <Tr key={record.id} className="transition-colors hover:bg-mist-50">
              <Td>
                <button
                  type="button"
                  onClick={() => onSelect(record)}
                  className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
                >
                  {valueLabel(record)}
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
