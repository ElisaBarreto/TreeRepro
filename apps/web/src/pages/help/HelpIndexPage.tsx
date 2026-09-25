import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchHelpTopics, helpKeys } from '../../api/help.ts';
import { TopicDialog } from '../../components/help/TopicDialog.tsx';
import { Alert, Button, PageHeader } from '../../components/ui/index.ts';
import { helpHref } from '../../content/help/href.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

/**
 * The help index (RFC-73 R1, R2): every stored topic with its one-line
 * summary, each linking to its own page. A `help.edit` holder also gets
 * **New topic** (RFC-73 R7). The title links, not the whole card, so each
 * link's accessible name is the topic's own title.
 * @rfc RFC-13 R2
 * @rfc RFC-73 R1, R2, R7
 */
export function HelpIndexPage() {
  const me = useMe();
  const canEdit = hasPermission(me, 'help.edit');
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: helpKeys.index(), queryFn: fetchHelpTopics });

  return (
    <>
      <PageHeader
        title="Help"
        description="How contributing works, what the words mean, and where to ask."
        actions={canEdit ? <Button onClick={() => setCreating(true)}>New topic</Button> : undefined}
      />
      {query.error ? <Alert tone="error">{pageErrorMessage(query.error)}</Alert> : null}
      <ul aria-label="Help topics" className="flex max-w-[72ch] flex-col gap-3">
        {(query.data ?? []).map((topic) => (
          <li
            key={topic.id}
            className="rounded-[10px] border border-canopy-700/15 bg-white px-5 py-4"
          >
            <Link
              to={helpHref(topic.slug)}
              className="font-display text-card font-semibold text-canopy-950 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
            >
              {topic.title}
            </Link>
            {topic.summary ? <p className="mt-1 text-body text-mist-500">{topic.summary}</p> : null}
          </li>
        ))}
      </ul>
      {creating ? (
        <TopicDialog
          onClose={() => setCreating(false)}
          onSaved={(topic) => {
            setCreating(false);
            void navigate({ to: helpHref(topic.slug) });
          }}
        />
      ) : null}
    </>
  );
}
