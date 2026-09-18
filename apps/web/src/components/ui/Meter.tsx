export interface MeterProps {
  /** The current amount, in the same unit as `max`. */
  value: number;
  /** The amount `value` is measured against. */
  max: number;
  /** The meter's accessible name; also what the number beside it describes. */
  label: string;
  /**
   * The percentage to write beside the bar, when the producer of `value` and
   * `max` has already computed it. Without it the component rounds the float
   * quotient itself, which is right for a meter whose source has no opinion
   * and wrong for one whose source does: the coverage API rounds halves up in
   * integer arithmetic (RFC-69 R5) precisely because the float quotient of
   * two counts can land just under a half that is exactly a half, and the two
   * then disagree by one.
   */
  percent?: number;
}

/**
 * A share of a whole as a native `<meter>` — real browser semantics
 * (`role="meter"`, a value announced against its max) — with the rounded
 * percentage written out beside it, since a `<meter>`'s fill is not itself
 * readable text. Tailwind utility classes only, no `style` attribute: the
 * kit's rule against inline styles applies to this element as much as any
 * other. General on purpose — a coverage percentage here, a completeness
 * percentage in plan 11c, an import progress in plan 12d — so it takes no
 * opinion beyond value, max and label.
 * @rfc RFC-72 R3
 */
export function Meter({ value, max, label, percent }: MeterProps) {
  const shown = percent ?? (max > 0 ? Math.round((value / max) * 100) : 0);
  return (
    <div className="flex items-center gap-2.5">
      <meter
        value={value}
        max={max}
        aria-label={label}
        className="h-2 w-full flex-1 rounded-full"
      />
      <span className="text-meta tabular-nums text-mist-500">{shown}%</span>
    </div>
  );
}
