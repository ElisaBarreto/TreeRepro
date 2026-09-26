import type { ReviewStatus } from '@treerepro/contracts';
import { Badge } from '../ui/index.ts';

const TONES: Record<ReviewStatus, 'neutral' | 'green' | 'red'> = {
  contested: 'red',
  validated: 'green',
  unvalidated: 'neutral',
};

const LABELS: Record<ReviewStatus, string> = {
  contested: 'Contested',
  validated: 'Validated',
  unvalidated: 'Unvalidated',
};

/**
 * The review state of a record as a chip.
 * @rfc RFC-63 R6
 */
export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return <Badge tone={TONES[status]}>{LABELS[status]}</Badge>;
}
