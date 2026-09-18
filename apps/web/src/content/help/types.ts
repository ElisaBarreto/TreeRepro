import type { ReactNode } from 'react';

/**
 * One help topic: what the index lists and what `/app/help/$topic` renders
 * (RFC-73 R2). `slug` is the URL segment, `title` the `h1` and the
 * breadcrumb crumb, `summary` the one line under it and on the index.
 */
export interface HelpTopic {
  slug: string;
  title: string;
  summary: string;
  body: ReactNode;
}

/**
 * A topic as its own module writes it: the topic plus the heading ids its
 * body carries, listed beside the prose that defines them so the two are
 * edited together. `anchors.test.ts` checks every `helpHref` call against
 * them and `HelpTopicPage.test.tsx` checks each one is really a heading id.
 */
export interface HelpTopicSource extends HelpTopic {
  anchors: readonly string[];
}
