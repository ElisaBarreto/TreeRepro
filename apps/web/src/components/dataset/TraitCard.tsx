import type { Dictionary, RecordIntent, TraitSummary } from '@treerepro/contracts';
import { useHasMaps } from '../../api/maps.ts';
import { helpHref } from '../../content/help/href.ts';
import { formatNumber, humaniseKey } from '../../lib/format.ts';
import { Badge, Button, HelpTip } from '../ui/index.ts';
import { CardFrame } from './CardFrame.tsx';
import { traitTip } from './trait-tip.ts';
import { VoteButton } from './VoteButton.tsx';

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

/** One level of a categorical trait as the summary gives it. @rfc RFC-63 R10 */
export type LevelSummary = NonNullable<TraitSummary['levels']>[number];

/**
 * One trait of a species. The card itself is a button that opens the trait's
 * records, naming the trait, its unit and record count, what still waits for
 * harmonisation, a **Contested** badge while any of its levels or records is
 * contested (R-9), and — for a measurement — min · mean · max (R-5, the mean
 * a dash when no record has a single value or a mean). Below it, outside the
 * button so no control nests in another, a categorical trait lists **every**
 * level the species has (spec §2; no cap): its record count, its validations
 * (✓ n), a bar scaled against the most frequent level, its own **Contested**
 * badge, and Validate/Contest/Complement — each present only when the page
 * passes its handler. Beside the card sit the `?` with the dictionary's
 * description (RFC-13 R11) and the "+" that opens the entry dialog for the
 * trait (RFC-65 R1). The `?` also opens for a trait with no description but
 * maps of its own, holding a **Maps** link to its trait maps page, when
 * `useMaps` names one (RFC-76 R8); a failed maps query reads as no maps.
 * @rfc RFC-13 R11
 * @rfc RFC-63 R10
 * @rfc RFC-65 R1
 * @rfc RFC-70 R1, R4
 * @rfc RFC-76 R8
 */
export function TraitCard({
  summary,
  dictionary,
  onOpen,
  onAdd,
  onValidateLevel,
  onRespondLevel,
}: {
  summary: TraitSummary;
  dictionary?: Dictionary;
  onOpen: () => void;
  onAdd?: () => void;
  onValidateLevel?: (level: LevelSummary) => void;
  onRespondLevel?: (level: LevelSummary, intent: RecordIntent) => void;
}) {
  const { trait, recordCount, numeric } = summary;
  const levels = summary.levels ?? [];
  const pending = pendingCount(summary);
  const maxCount = Math.max(0, ...levels.map((level) => level.count));
  const name = humaniseKey(trait.key);
  const tip = traitTip(dictionary, trait);
  const hasMaps = useHasMaps(trait.id);

  return (
    <CardFrame>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <button
          type="button"
          onClick={onOpen}
          className="flex flex-col gap-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
        >
          <span className="flex w-full items-start justify-between gap-3">
            <span className="flex flex-col">
              <span className="font-display text-card font-semibold text-canopy-950">{name}</span>
              <span className="text-meta text-mist-500">
                {trait.unit ? `${trait.unit} · ` : ''}
                {recordCount} {recordCount === 1 ? 'record' : 'records'}
              </span>
            </span>
            <span className="flex flex-wrap justify-end gap-1.5">
              {summary.contested ? <Badge tone="red">Contested</Badge> : null}
              {pending > 0 ? <Badge tone="amber">{pending} pending</Badge> : null}
            </span>
          </span>
          {numeric ? (
            <span className="flex flex-col">
              <span className="text-label uppercase tracking-[0.06em] text-mist-500">
                min · mean · max
              </span>
              <span className="text-body tabular-nums text-canopy-900">
                {`${formatNumber(numeric.min)} · ${numeric.mean === null ? '—' : formatNumber(numeric.mean)} · ${formatNumber(numeric.max)}${trait.unit ? ` ${trait.unit}` : ''}`}
              </span>
            </span>
          ) : null}
        </button>

        {levels.length > 0 ? (
          <ul aria-label={`Levels of ${name}`} className="flex flex-col gap-3">
            {levels.map((level) => (
              <li key={level.levelId} className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2 text-meta text-canopy-900">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{level.key}</span>
                    {level.contested ? <Badge tone="red">Contested</Badge> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 tabular-nums text-mist-500">
                    <span>
                      {level.count}
                      <span className="sr-only">{level.count === 1 ? ' record' : ' records'}</span>
                    </span>
                    <span>
                      <span aria-hidden="true">✓</span> {level.validationCount}
                      <span className="sr-only"> validated</span>
                    </span>
                  </span>
                </span>
                <span aria-hidden="true" className="block h-2 w-full rounded-full bg-mist-100">
                  <span
                    className={`block h-full rounded-full bg-canopy-500 ${widthClass(level.count, maxCount)}`}
                  />
                </span>
                {onValidateLevel || onRespondLevel ? (
                  <span className="flex gap-1.5">
                    {onValidateLevel ? (
                      <VoteButton
                        icon="thumbsUp"
                        label={`Validate ${level.key} for ${name}`}
                        onClick={() => onValidateLevel(level)}
                      />
                    ) : null}
                    {onRespondLevel ? (
                      <>
                        <VoteButton
                          icon="thumbsDown"
                          label={`Contest ${level.key} for ${name}`}
                          onClick={() => onRespondLevel(level, 'contest')}
                        />
                        <VoteButton
                          icon="plus"
                          label={`Complement ${level.key} for ${name}`}
                          onClick={() => onRespondLevel(level, 'complement')}
                        />
                      </>
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <span className="flex shrink-0 items-center gap-1">
        {tip || hasMaps ? (
          <HelpTip
            label={`What does ${name} mean?`}
            learnMore={helpHref('vocabulary', 'descriptions')}
            extraLink={hasMaps ? { to: `/app/maps/${trait.id}`, label: 'Maps' } : undefined}
          >
            {tip ?? 'Global maps are available for this trait.'}
          </HelpTip>
        ) : null}
        {onAdd ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Add value for ${name}`}
            onClick={onAdd}
            className="shrink-0 px-3"
          >
            +
          </Button>
        ) : null}
      </span>
    </CardFrame>
  );
}
