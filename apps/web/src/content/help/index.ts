import { contact } from './contact.tsx';
import { contributions } from './contributions.tsx';
import { faq } from './faq.tsx';
import { gettingStarted } from './getting-started.tsx';
import { references } from './references.tsx';
import { scope } from './scope.tsx';
import type { HelpTopic, HelpTopicSource } from './types.ts';
import { vocabulary } from './vocabulary.tsx';
import { workflow } from './workflow.tsx';

export { helpHref } from './href.ts';
export type { HelpTopic, HelpTopicSource } from './types.ts';

// The reading order of the index: what the app is, then how a contribution
// is made, then the words it uses, then where to ask (RFC-73 R1).
const SOURCES: readonly HelpTopicSource[] = [
  gettingStarted,
  workflow,
  vocabulary,
  references,
  scope,
  contributions,
  faq,
  contact,
];

/**
 * Every help topic, in the order the index lists them (RFC-73 R1, R2).
 * @rfc RFC-73 R1, R2
 */
export const HELP_TOPICS: readonly HelpTopic[] = SOURCES;

/**
 * The heading ids each topic's body carries, by slug (RFC-73 R2): what a
 * `HelpTip`'s "Learn more" may point at, and what `anchors.test.ts` checks
 * every call site against.
 * @rfc RFC-73 R2, R4
 */
export const HELP_ANCHORS: Record<string, readonly string[]> = Object.fromEntries(
  SOURCES.map((topic) => [topic.slug, topic.anchors]),
);

/**
 * The topic a slug names, or `undefined` — an unknown topic renders the
 * index rather than an error (RFC-73 R1).
 * @rfc RFC-73 R1
 */
export function helpTopic(slug: string): HelpTopic | undefined {
  return SOURCES.find((topic) => topic.slug === slug);
}
