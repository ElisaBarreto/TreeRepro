import type { ReviewStatus } from '@treerepro/contracts';
import { Badge } from '../ui/index.ts';

const TONES: Record<ReviewStatus, 'neutral' | 'green' | 'red'> = {
  unreviewed: 'neutral',
  confirmed: 'green',
  disputed: 'red',
  withdrawn: 'neutral',
};

/**
 * The review axis of a record as a chip; a withdrawn record reads struck through.
 * @rfc RFC-63 R6
 */
export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return (
    <Badge tone={TONES[status]}>
      {status === 'withdrawn' ? <span className="line-through">{status}</span> : status}
    </Badge>
  );
}
