import type { TraitSummary } from '@treerepro/contracts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { Badge, Button } from '../ui/index.ts';

const MAX_BARS = 5;

// One class per tenth, spelled out so Tailwind finds them at build time; a
// bar's width is a class, never a style attribute (RFC-13 R5).
const WIDTHS = [
  'w-1/10',
  'w-2/10',
  'w-3/10',
  'w-4/10',
  'w-5/10',
  'w-6/10',
  'w-7/10',
  'w-8/10',
  'w-9/10',
  'w-full',
] as const;

function widthClass(count: number, max: number): string {
  const tenths = Math.min(WIDTHS.length, Math.max(1, Math.round((count / max) * WIDTHS.length)));
  return WIDTHS[tenths - 1] ?? 'w-full';
}

function pendingCount(summary: TraitSummary): number {
  const { unknownLevel, multiValue, notNumeric, empty } = summary.harmonisationCounts;
  return unknownLevel + multiValue + notNumeric + empty;
}

/**
 * One trait of a species, as a button that opens its records, plus an
 * optional separate "Add value" button (RFC-65 R1) — a sibling, never
 * nested inside the main button. Shows the summary the API computed
 * (RFC-63 R10): the top levels as bars scaled against the most frequent
 * one, or min · median · max for a measurement, how many records still
 * wait for harmonisation, and the accepted value. Only spans inside the
 * main button, so its content stays phrasing content.
 * @rfc RFC-63 R10
 * @rfc RFC-65 R1
 */
export function TraitCard({
  summary,
  onOpen,
  onAdd,
}: {
  summary: TraitSummary;
  onOpen: () => void;
  onAdd?: () => void;
}) {
  const { trait, recordCount, levels, numeric, accepted } = summary;
  const pending = pendingCount(summary);
  const bars = levels?.slice(0, MAX_BARS) ?? [];
  const maxCount = Math.max(0, ...bars.map((level) => level.count));

  return (
    <div className="flex items-start gap-3 rounded-xl border border-canopy-700/15 bg-white p-5 shadow-[0_1px_2px_rgba(7,31,28,0.04)] transition-colors hover:border-canopy-600/50 hover:bg-mist-50/60">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
      >
        <span className="flex w-full items-start justify-between gap-3">
          <span className="flex flex-col">
            <span className="font-display text-card font-semibold text-canopy-950">
              {humaniseKey(trait.key)}
            </span>
            <span className="text-meta text-mist-500">
              {trait.unit ? `${trait.unit} · ` : ''}
              {recordCount} {recordCount === 1 ? 'record' : 'records'}
            </span>
          </span>
          {pending > 0 ? <Badge tone="amber">{pending} pending</Badge> : null}
        </span>

        {bars.length > 0 ? (
          <span className="flex w-full flex-col gap-2.5">
            {bars.map((level) => (
              <span key={level.levelId} className="flex flex-col gap-0.5">
                <span className="flex justify-between gap-2 text-meta text-canopy-900">
                  <span className="truncate">{level.key}</span>
                  <span className="tabular-nums text-mist-500">{level.count}</span>
                </span>
                <span aria-hidden="true" className="block h-2 w-full rounded-full bg-mist-100">
                  <span
                    className={`block h-full rounded-full bg-canopy-500 ${widthClass(level.count, maxCount)}`}
                  />
                </span>
              </span>
            ))}
          </span>
        ) : null}

        {numeric ? (
          <span className="flex flex-col">
            <span className="text-label uppercase tracking-[0.06em] text-mist-500">
              min · median · max
            </span>
            <span className="text-body tabular-nums text-canopy-900">
              {`${formatNumber(numeric.min)} · ${formatNumber(numeric.median)} · ${formatNumber(numeric.max)}${trait.unit ? ` ${trait.unit}` : ''}`}
            </span>
          </span>
        ) : null}

        {accepted ? (
          <span className="text-body text-canopy-800">
            <span className="text-mist-500">accepted: </span>
            {accepted.valueText}
          </span>
        ) : null}
      </button>
      {onAdd ? (
        <Button
          variant="secondary"
          size="sm"
          aria-label="Add value"
          onClick={onAdd}
          className="shrink-0 px-3"
        >
          +
        </Button>
      ) : null}
    </div>
  );
}
