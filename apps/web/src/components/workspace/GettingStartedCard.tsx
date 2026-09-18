import { Link } from '@tanstack/react-router';
import type { ContributionSummary } from '@treerepro/contracts';
import { useState } from 'react';
import { helpHref } from '../../content/help/href.ts';
import { readFlag, writeFlag } from '../../lib/storage.ts';
import { Button } from '../ui/index.ts';

const HIDDEN_STORAGE_KEY = 'treerepro.gettingStarted.hidden';
const LINK_CLASS = 'font-medium text-canopy-900 underline-offset-2 hover:underline';

// RFC-71 R4's seven counts; the card never shows for a viewer with any
// contribution, so a single non-zero field turns this false permanently for
// that viewer (the flag only ever hides a card that would otherwise show).
function hasNoContribution(summary: ContributionSummary): boolean {
  return (
    summary.records === 0 &&
    summary.contests === 0 &&
    summary.complements === 0 &&
    summary.validations === 0 &&
    summary.disputes === 0 &&
    summary.withdrawn === 0 &&
    summary.accepted === 0
  );
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

  if (hidden || !hasNoContribution(summary)) return null;

  function onHide() {
    writeFlag(HIDDEN_STORAGE_KEY, true);
    setHidden(true);
  }

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="flex flex-col gap-4 rounded-xl border border-canopy-700/15 bg-white p-6"
    >
      <h2
        id="getting-started-heading"
        className="font-display text-section font-semibold text-canopy-950"
      >
        Getting started
      </h2>
      <p className="text-body text-mist-500">
        A few places to start now that you have access. Each one opens straight into what it
        describes.
      </p>
      <ul aria-label="Getting started checklist" className="flex flex-col gap-2 text-body">
        <li>
          <Link to={helpHref('workflow')} className={LINK_CLASS}>
            Learn how validating, contesting and complementing a record work
          </Link>
        </li>
        <li>
          <Link to="/app/species" search={{ scope: 'plots' }} className={LINK_CLASS}>
            Browse the species in your plots
          </Link>
        </li>
        <li>
          <Link to="/app/species" search={{ sort: 'completeness' }} className={LINK_CLASS}>
            See which species have the least complete data
          </Link>
        </li>
        <li>
          <Link to="/app/species" search={{ traitData: 'missing' }} className={LINK_CLASS}>
            Find traits missing data you could enter
          </Link>
        </li>
      </ul>
      <div>
        <Button variant="secondary" onClick={onHide}>
          Hide this card
        </Button>
      </div>
    </section>
  );
}
