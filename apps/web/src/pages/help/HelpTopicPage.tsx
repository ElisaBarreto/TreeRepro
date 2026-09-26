import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { HelpSection, HelpTopic } from '@treerepro/contracts';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client.ts';
import {
  deleteHelpSection,
  deleteHelpTopic,
  fetchHelpTopic,
  helpKeys,
  updateHelpSection,
} from '../../api/help.ts';
import { HelpSectionEditor } from '../../components/help/HelpSectionEditor.tsx';
import { HtmlBody } from '../../components/help/HtmlBody.tsx';
import { TopicDialog } from '../../components/help/TopicDialog.tsx';
import { useBreadcrumb } from '../../components/shell/Breadcrumb.tsx';
import { Alert, Button, ConfirmDialog, PageHeader, Prose } from '../../components/ui/index.ts';
import { pageErrorMessage } from '../../lib/errors.ts';
import { realignHashWhileSettling } from '../../lib/hashAnchor.ts';
import { hasPermission, useMe } from '../../lib/session.ts';
import { HelpIndexPage } from './HelpIndexPage.tsx';

type Pending = { kind: 'topic' } | { kind: 'section'; section: HelpSection } | null;

/**
 * One help topic (RFC-73 R1, R2): its title, its summary and its sections,
 * each titled section an `h2` carrying its anchor so a `#anchor` link lands.
 * An unknown slug renders the index. A `help.edit` holder also gets the
 * edit controls of RFC-73 R7.
 * @rfc RFC-13 R2, R3
 * @rfc RFC-73 R1, R2, R7
 */
export function HelpTopicPage({ slug }: { slug: string }) {
  const me = useMe();
  const canEdit = hasPermission(me, 'help.edit');
  const query = useQuery({ queryKey: helpKeys.topic(slug), queryFn: () => fetchHelpTopic(slug) });
  const topic = query.data;
  useBreadcrumb(topic ? [{ label: topic.title }] : []);
  // Armed once the sections are in the DOM, so there is a heading to find.
  const loaded = Boolean(topic);
  useEffect(() => (loaded ? realignHashWhileSettling() : undefined), [loaded]);

  if (query.error instanceof ApiError && query.error.code === 'HELP_TOPIC_NOT_FOUND')
    return <HelpIndexPage />;
  if (query.error) return <Alert tone="error">{pageErrorMessage(query.error)}</Alert>;
  if (!topic) return <p className="text-body text-mist-500">Loading…</p>;
  return <TopicView topic={topic} canEdit={canEdit} />;
}

function TopicView({ topic, canEdit }: { topic: HelpTopic; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState(false);
  const [confirm, setConfirm] = useState<Pending>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: helpKeys.all });

  const move = useMutation({
    mutationFn: ({ id, position }: { id: string; position: number }) =>
      updateHelpSection(id, { position }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (target: NonNullable<Pending>) => {
      if (target.kind === 'topic') await deleteHelpTopic(topic.id);
      else await deleteHelpSection(target.section.id);
      return target.kind;
    },
    onSuccess: async (kind) => {
      setConfirm(null);
      if (kind === 'topic') {
        queryClient.removeQueries({ queryKey: helpKeys.topic(topic.slug) });
        await navigate({ to: '/app/help' });
      }
      await invalidate();
    },
  });

  return (
    <>
      <PageHeader
        title={topic.title}
        description={topic.summary}
        actions={
          canEdit ? (
            <>
              <Button variant="secondary" onClick={() => setEditingTopic(true)}>
                Edit topic
              </Button>
              <Button variant="danger" onClick={() => setConfirm({ kind: 'topic' })}>
                Delete topic
              </Button>
            </>
          ) : undefined
        }
      />
      {move.error ? <Alert tone="error">{pageErrorMessage(move.error)}</Alert> : null}
      <Prose>
        {topic.sections.map((section, index) =>
          editing === section.id ? (
            <HelpSectionEditor
              key={section.id}
              topicId={topic.id}
              section={section}
              onDone={() => setEditing(null)}
            />
          ) : (
            <section key={section.id}>
              {section.title ? <h2 id={section.anchor ?? undefined}>{section.title}</h2> : null}
              {canEdit ? (
                <fieldset
                  aria-label={`Section: ${section.title || 'untitled'}`}
                  className="m-0 mb-2 flex flex-wrap gap-1.5 border-0 p-0"
                >
                  <Button size="sm" variant="secondary" onClick={() => setEditing(section.id)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={index === 0 || move.isPending}
                    onClick={() => move.mutate({ id: section.id, position: index - 1 })}
                  >
                    Move up
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={index === topic.sections.length - 1 || move.isPending}
                    onClick={() => move.mutate({ id: section.id, position: index + 1 })}
                  >
                    Move down
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirm({ kind: 'section', section })}
                  >
                    Delete
                  </Button>
                </fieldset>
              ) : null}
              <HtmlBody html={section.bodyHtml} />
            </section>
          ),
        )}
      </Prose>
      {canEdit ? (
        editing === 'new' ? (
          <HelpSectionEditor topicId={topic.id} onDone={() => setEditing(null)} />
        ) : (
          <div className="mt-6">
            <Button onClick={() => setEditing('new')}>Add section</Button>
          </div>
        )
      ) : null}
      {editingTopic ? (
        <TopicDialog
          topic={topic}
          onClose={() => setEditingTopic(false)}
          onSaved={() => setEditingTopic(false)}
        />
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title={confirm.kind === 'topic' ? 'Delete topic' : 'Delete section'}
          message={
            confirm.kind === 'topic'
              ? `Delete “${topic.title}” and all its sections? This cannot be undone.`
              : `Delete the section “${confirm.section.title || 'untitled'}”? This cannot be undone.`
          }
          confirmLabel="Delete"
          danger
          pending={remove.isPending}
          error={remove.error ? pageErrorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(confirm)}
          onClose={() => {
            remove.reset();
            setConfirm(null);
          }}
        />
      ) : null}
    </>
  );
}
