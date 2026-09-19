import { Link } from '@tanstack/react-router';
import { PageHeader } from '../../components/ui/index.ts';
import { HELP_TOPICS, helpHref } from '../../content/help/index.ts';

/**
 * The help index (RFC-73 R1, R2): every topic with its one-line summary,
 * each linking to its own page. It needs no permission and reads nothing
 * from the API — the content is TSX in `content/help` — so it is the one
 * screen a signed-in user can always open. The title links, not the whole
 * card, so each link's accessible name is the topic's own title.
 * @rfc RFC-13 R2
 * @rfc RFC-73 R1, R2
 */
export function HelpIndexPage() {
  return (
    <>
      <PageHeader
        title="Help"
        description="How contributing works, what the words mean, and where to ask."
      />
      <ul aria-label="Help topics" className="flex max-w-[72ch] flex-col gap-3">
        {HELP_TOPICS.map((topic) => (
          <li
            key={topic.slug}
            className="rounded-[10px] border border-canopy-700/15 bg-white px-5 py-4"
          >
            <Link
              to={helpHref(topic.slug)}
              className="font-display text-card font-semibold text-canopy-950 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
            >
              {topic.title}
            </Link>
            <p className="mt-1 text-body text-mist-500">{topic.summary}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
