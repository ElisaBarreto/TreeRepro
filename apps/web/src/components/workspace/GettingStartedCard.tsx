import { Link, type LinkProps } from '@tanstack/react-router';
import type { ContributionSummary } from '@treerepro/contracts';
import { useId, useState } from 'react';
import { helpHref } from '../../content/help/href.ts';
import { readFlag, writeFlag } from '../../lib/storage.ts';

const HIDDEN_STORAGE_KEY = 'treerepro.gettingStarted.hidden';
const CARD_CLASS =
  'flex h-full flex-col gap-3.5 rounded-2xl border border-canopy-700/15 bg-white p-5.5 text-canopy-950 transition-colors hover:border-canopy-700/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';
const BADGE_CLASS =
  'flex size-9 items-center justify-center rounded-full bg-canopy-200 font-display text-meta font-bold text-canopy-800';
const HIDE_CLASS =
  'h-11 rounded-full px-3.5 font-display text-meta font-semibold text-canopy-700 transition-colors hover:text-canopy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500';

// The four doors, in the checklist's order: the title is the destination,
// the call to action what the click does there.
const STEPS: readonly {
  title: string;
  cta: string;
  to: LinkProps['to'];
  search?: LinkProps['search'];
}[] = [
  {
    title: 'Learn how validating, contesting and complementing a record work',
    cta: 'Read the guide',
    // `helpHref` answers a plain string (it may carry a `#anchor`); the
    // help topic route it names is `/app/help/$topic`.
    to: helpHref('workflow') as LinkProps['to'],
  },
  {
    title: 'Browse the species in your plots',
    cta: 'Open your plots',
    to: '/app/species',
    search: { scope: 'plots' },
  },
  {
    title: 'See which species have the least complete data',
    cta: 'Show gaps',
    to: '/app/species',
    search: { sort: 'completeness' },
  },
  {
    title: 'Find traits missing data you could enter',
    cta: 'Find traits',
    to: '/app/species',
    search: { traitData: 'missing' },
  },
];

// RFC-71 R4's seven counts, read off the object rather than named one by
// one: an eighth count added to the contract later is then covered without
// anyone remembering this function, and so is a field that is not a number
// at all — both make this false, which hides the card, the safe direction
// for something only ever meant for a viewer with nothing to their name.
// The card never shows for a viewer with any contribution, so a single
// non-zero field turns this false permanently for that viewer (the flag only
// ever hides a card that would otherwise show).
function hasNoContribution(summary: ContributionSummary): boolean {
  return Object.values(summary).every((count) => count === 0);
}

/**
 * The workspace's first-run checklist (spec, RFC-73 R3): shown only to a
 * viewer whose contribution summary is all zeros, and only until they
 * dismiss it. Dismissal is remembered in `localStorage` under
 * `treerepro.gettingStarted.hidden` (via `readFlag`/`writeFlag`, which
 * degrade to "never hidden" rather than throw when storage is unavailable),
 * but the flag alone never shows the card back: any real contribution hides
 * it for good, whatever the flag says.
 * @rfc RFC-73 R3
 */
export function GettingStartedCard({ summary }: { summary: ContributionSummary }) {
  const [hidden, setHidden] = useState(() => readFlag(HIDDEN_STORAGE_KEY));
  const headingId = useId();

  if (hidden || !hasNoContribution(summary)) return null;

  function onHide() {
    writeFlag(HIDDEN_STORAGE_KEY, true);
    setHidden(true);
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={headingId} className="font-display text-section font-semibold text-canopy-950">
          Getting started
        </h2>
        <button type="button" onClick={onHide} className={HIDE_CLASS}>
          Hide this card
        </button>
      </div>
      <ol
        aria-label="Getting started checklist"
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      >
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Link to={step.to} search={step.search} className={CARD_CLASS}>
              <span aria-hidden="true" className={BADGE_CLASS}>
                {index + 1}
              </span>
              <span className="grow text-body font-semibold">{step.title}</span>
              <span className="text-meta font-bold text-canopy-700">
                {step.cta} <span aria-hidden="true">→</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
