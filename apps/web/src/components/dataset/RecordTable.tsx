import { Link } from '@tanstack/react-router';
import type { RecordItem, ReferenceRef } from '@treerepro/contracts';
import { formatNumber, humaniseKey, isoDate, truncate } from '../../lib/format.ts';
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';
import { HarmonisationBadge } from './HarmonisationBadge.tsx';
import { ReviewBadge } from './ReviewBadge.tsx';

const ARTICLE_MAX = 60;
const DASH = <span className="text-mist-500">—</span>;

// The harmonised value when there is one, else the text as it was entered.
function valueLabel(record: RecordItem): string {
  if (record.level) return record.level.key;
  if (record.numericValue !== null) {
    const unit = record.trait.unit ? ` ${record.trait.unit}` : '';
    return `${formatNumber(record.numericValue)}${unit}`;
  }
  return record.valueText || '(empty)';
}

// One role's article: its citation key linked to the reference page, cut at
// sixty characters with the whole key in the link's `title`; a dash when the
// record names no article in that role.
function ArticleCell({ reference }: { reference: ReferenceRef | null }) {
  if (!reference) return <Td>{DASH}</Td>;
  const shown = truncate(reference.citationKey, ARTICLE_MAX);
  return (
    <Td>
      <Link
        to="/app/references/$id"
        params={{ id: reference.id }}
        title={shown === reference.citationKey ? undefined : reference.citationKey}
        className="font-medium text-canopy-900 underline-offset-2 hover:underline"
      >
        {shown}
      </Link>
    </Td>
  );
}

/**
 * Records as rows: value, the primary and the secondary article (each linked
 * to its reference page; the same article may fill both roles), origin, the
 * two status chips and the date added. The value is a button that selects
 * the row, so every record is reachable by keyboard. Outside a species page
 * (`showSpecies`) a first column names each row's species and links to it;
 * outside a trait panel (`showTrait`) a column names the trait, so a row
 * reads on its own.
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
          <Th>Primary article</Th>
          <Th>Secondary article</Th>
          <Th>Origin</Th>
          <Th>Harmonisation</Th>
          <Th>Review</Th>
          <Th>Added</Th>
        </Tr>
      </Thead>
      <Tbody>
        {records.map((record) => {
          const value = valueLabel(record);
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
              <ArticleCell reference={record.primaryReference} />
              <ArticleCell reference={record.secondaryReference} />
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
