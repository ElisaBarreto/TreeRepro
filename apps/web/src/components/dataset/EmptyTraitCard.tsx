import type { Dictionary, TraitSummary } from '@treerepro/contracts';
import { useHasMaps } from '../../api/maps.ts';
import { helpHref } from '../../content/help/href.ts';
import { humaniseKey } from '../../lib/format.ts';
import { Button, HelpTip } from '../ui/index.ts';
import { CardFrame } from './CardFrame.tsx';
import { traitTip } from './trait-tip.ts';

/**
 * A trait `includeMissing` added: it has no record at all, so there is
 * nothing to open — no bars, no min · median · max, no accepted value, just
 * the name, the `?` that explains it ({@link traitTip}) and, for
 * `records.create`, a way to start one. A zero-count categorical trait
 * answers `levels: []`, never `null` (RFC-63 R10 amended by RFC-70 R7); this
 * card does not read `levels` at all, so that distinction is someone else's
 * to keep, not this one's to get wrong. The `?` also opens for a trait with
 * no description but maps of its own, holding a **Maps** link (RFC-76 R8); a
 * failed maps query reads as no maps.
 * @rfc RFC-70 R7
 * @rfc RFC-13 R11
 * @rfc RFC-76 R8
 */
export function EmptyTraitCard({
  summary,
  dictionary,
  onAdd,
}: {
  summary: TraitSummary;
  dictionary?: Dictionary;
  onAdd?: () => void;
}) {
  const { trait } = summary;
  const name = humaniseKey(trait.key);
  const tip = traitTip(dictionary, trait);
  const hasMaps = useHasMaps(trait.id);

  return (
    <CardFrame>
      <div className="flex w-full flex-col gap-3">
        <span className="flex items-center gap-1">
          <span className="font-display text-card font-semibold text-canopy-950">
            {trait.unit ? `${name} (${trait.unit})` : name}
          </span>
          {tip || hasMaps ? (
            <HelpTip
              label={`What does ${name} mean?`}
              learnMore={helpHref('vocabulary', 'descriptions')}
              extraLink={hasMaps ? { to: `/app/maps/${trait.id}`, label: 'Maps' } : undefined}
            >
              {tip ?? 'Global maps are available for this trait.'}
            </HelpTip>
          ) : null}
        </span>
        <p className="text-meta text-mist-500">No records yet</p>
        {onAdd ? (
          <Button variant="secondary" size="sm" onClick={onAdd} className="self-start">
            Add the first entry
          </Button>
        ) : null}
      </div>
    </CardFrame>
  );
}
