import type { Dashboard } from '@treerepro/contracts';
import { formatNumber } from '../../lib/format.ts';
import { ButtonLink, Chip } from '../ui/index.ts';

/**
 * "Your scope": the viewer's own plots as chips carrying their species
 * count, a note when browsing is restricted to them, and a way out to the
 * full species list. Rendered only while `scope` is not null (RFC-72 R1) —
 * that null check belongs to the caller, not to this component.
 * @rfc RFC-72 R3
 */
export function ScopeCard({ scope }: { scope: NonNullable<Dashboard['scope']> }) {
  return (
    <section
      aria-labelledby="scope-heading"
      className="flex flex-col gap-4 rounded-xl border border-canopy-700/15 bg-white p-6"
    >
      <h2 id="scope-heading" className="font-display text-section font-semibold text-canopy-950">
        Your scope
      </h2>
      <ul aria-label="Your plots" className="flex flex-wrap gap-2">
        {scope.plots.map((plot) => (
          <li key={plot.id}>
            <Chip>
              {plot.name} · {formatNumber(plot.speciesCount)} species
            </Chip>
          </li>
        ))}
      </ul>
      {scope.restricted ? (
        <p className="text-meta text-mist-500">Restricted to your plots.</p>
      ) : null}
      <div>
        <ButtonLink to="/app/species" variant="secondary">
          Browse species
        </ButtonLink>
      </div>
    </section>
  );
}
