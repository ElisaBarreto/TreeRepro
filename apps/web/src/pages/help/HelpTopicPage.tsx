import { useEffect } from 'react';
import { useBreadcrumb } from '../../components/shell/Breadcrumb.tsx';
import { PageHeader, Prose } from '../../components/ui/index.ts';
import { helpTopic } from '../../content/help/index.ts';
import { realignHashWhileSettling } from '../../lib/hashAnchor.ts';
import { HelpIndexPage } from './HelpIndexPage.tsx';

/**
 * One help topic (RFC-73 R1, R2): its title, its summary and its body, laid
 * out by `Prose` so the heading ids the body carries survive for a `#anchor`
 * link from a `HelpTip` to land on. An unknown slug renders the index rather
 * than an error — a stale bookmark or a renamed topic lands somewhere useful
 * (RFC-73 R1). The title is registered as the shell's trailing crumb, so the
 * breadcrumb reads `Help › <Topic>` (RFC-13 R3).
 * @rfc RFC-13 R2, R3
 * @rfc RFC-73 R1, R2
 */
export function HelpTopicPage({ slug }: { slug: string }) {
  const topic = helpTopic(slug);
  // Called before the branch below: an unknown topic registers no crumb, and
  // a hook may not be skipped.
  useBreadcrumb(topic ? [{ label: topic.title }] : []);
  // Armed here, not in `main.tsx`: this is the component that renders the
  // headings, so by the time the effect runs they are in the DOM and there
  // is something for the correction to find. Armed before the branch below
  // for the same reason as the crumb — a hook may not be skipped.
  useEffect(() => realignHashWhileSettling(), []);

  if (!topic) return <HelpIndexPage />;
  return (
    <>
      <PageHeader title={topic.title} description={topic.summary} />
      <Prose>{topic.body}</Prose>
    </>
  );
}
