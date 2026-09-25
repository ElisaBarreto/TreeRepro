import type { Dashboard } from '@treerepro/contracts';
import { CONTACT_EMAIL, PROJECT_HEADLINE, projectDescription } from '../../content/project.ts';
import { formatNumber } from '../../lib/format.ts';
import { QuickActions } from './QuickActions.tsx';

const LINK_CLASS = 'font-semibold text-pollen-300 underline-offset-2 hover:underline';

// The paragraph is one fixed string (RFC-72 R3); the only markup in it is
// the contact e-mail as a link, so it is found in the text and wrapped
// rather than templated a second time here.
function Description({ text }: { text: string }) {
  const [before, after] = text.split(CONTACT_EMAIL);
  return (
    <p className="text-body text-mist-100">
      {before}
      <a href={`mailto:${CONTACT_EMAIL}`} className={LINK_CLASS}>
        {CONTACT_EMAIL}
      </a>
      {after}
    </p>
  );
}

// The emblem's rings and branches as faint line art in the top-right corner:
// decoration only, still (motion stays on the landing page, RFC-13 R7).
function Rings() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 200"
      fill="none"
      strokeWidth="1.2"
      className="pointer-events-none absolute -top-18 -right-15 h-105 w-105 stroke-canopy-500/15"
    >
      <circle cx="100" cy="100" r="96" />
      <circle cx="100" cy="100" r="74" />
      <circle cx="100" cy="100" r="52" />
      <path d="M100 170V92M100 120l-26-22M100 108l24-20M100 140l-18-12M100 132l20-14" />
      <circle cx="100" cy="76" r="26" />
    </svg>
  );
}

// Divider per position: the band is two columns until the card itself is
// 32rem wide (a container query, since the sidebar makes the viewport a poor
// guide), so the third stat starts a row there (a top rule) and sits beside
// the second above it. The first lines up with the card's text.
const STAT_BORDERS = ['lg:pl-14', 'border-l', 'border-t @lg:border-t-0 @lg:border-l'];

/**
 * The dashboard's opening card and the page's h1 (RFC-72 R3): the greeting
 * by first name, the headline, what TreeRepro is with the dataset's live
 * counts substituted into the fixed copy, the quick actions under the text,
 * and those counts again as a band along the bottom.
 * @rfc RFC-72 R3
 */
export function IntroCard({ dataset, name }: { dataset: Dashboard['dataset']; name: string }) {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const stats = [
    { label: 'Species', value: dataset.speciesCount },
    { label: 'Records', value: dataset.recordCount },
    { label: 'References', value: dataset.referenceCount },
  ];
  return (
    <section
      aria-label="About TreeRepro"
      className="@container relative flex flex-col gap-7 overflow-hidden rounded-3xl bg-canopy-950 px-6 pt-8 text-mist-50 lg:px-14 lg:pt-12"
    >
      <Rings />
      <div className="relative flex max-w-3xl flex-col gap-3.5">
        <p className="text-label font-bold tracking-[0.12em] text-pollen-300 uppercase">
          Welcome back, {firstName}
        </p>
        <h1 className="font-display text-title font-bold">{PROJECT_HEADLINE}</h1>
      </div>
      <div className="relative">
        <Description text={projectDescription(dataset)} />
      </div>
      <div className="relative">
        <QuickActions />
      </div>
      <ul
        aria-label="Dataset"
        className="relative -mx-6 mt-2 grid grid-cols-2 border-t border-mist-50/15 @lg:grid-cols-3 lg:-mx-14"
      >
        {stats.map((stat, index) => (
          <li
            key={stat.label}
            className={`flex min-w-0 flex-col gap-1 border-mist-50/15 px-6 pt-5 pb-6 ${STAT_BORDERS[index]}`}
          >
            <span className="font-display text-title font-bold tabular-nums">
              {formatNumber(stat.value)}
            </span>
            <span className="text-label font-bold tracking-[0.08em] text-mist-300 uppercase">
              {stat.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
