import { Link } from '@tanstack/react-router';
import type { AnnotationKind, ContributionAnnotation } from '@treerepro/contracts';
import { humaniseKey, isoDate } from '../../lib/format.ts';
import { referenceLabel } from '../../lib/references.ts';
import { Badge, Table, Tbody, Td, Th, Thead, Tr } from '../ui/index.ts';

const DASH = <span className="text-mist-500">—</span>;

const TONES: Record<AnnotationKind, 'neutral' | 'green' | 'red'> = {
  confirm: 'green',
  dispute: 'red',
  neutral: 'neutral',
  withdraw: 'neutral',
};

/**
 * The viewer's annotations as rows: the date the annotation itself carries —
 * not the record's, which is what the date filters narrow (RFC-71 R3) — its
 * kind, the record it sits on, the note and the reference backing it. An
 * annotation the system wrote in the viewer's name (the dispute a contest
 * raises) reads "automatic". The record cell is a button, so every row opens
 * its record in the drawer by keyboard as well as by mouse.
 * @rfc RFC-71 R3
 * @rfc RFC-65 R3
 */
export function AnnotationTable({
  annotations,
  onSelect,
}: {
  annotations: ContributionAnnotation[];
  onSelect: (annotation: ContributionAnnotation) => void;
}) {
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Annotated</Th>
          <Th>Kind</Th>
          <Th>Record</Th>
          <Th>Note</Th>
          <Th>Support</Th>
        </Tr>
      </Thead>
      <Tbody>
        {annotations.map((annotation) => (
          <Tr key={annotation.id} className="transition-colors hover:bg-mist-50">
            <Td className="whitespace-nowrap tabular-nums">
              <time dateTime={annotation.createdAt}>{isoDate(annotation.createdAt)}</time>
            </Td>
            <Td>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={TONES[annotation.kind]}>{annotation.kind}</Badge>
                {annotation.generated ? <Badge>automatic</Badge> : null}
              </span>
            </Td>
            <Td>
              <button
                type="button"
                onClick={() => onSelect(annotation)}
                className="text-left font-medium text-canopy-900 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
              >
                <span className="italic">{annotation.record.species.canonicalName}</span> ›{' '}
                {humaniseKey(annotation.record.trait.key)}
              </button>
            </Td>
            <Td>{annotation.note ?? DASH}</Td>
            <Td>
              {annotation.reference ? (
                <span>
                  supported by{' '}
                  <Link
                    to="/app/references/$id"
                    params={{ id: annotation.reference.id }}
                    className="font-medium text-canopy-900 underline-offset-2 hover:underline"
                  >
                    {referenceLabel(annotation.reference)}
                  </Link>
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
