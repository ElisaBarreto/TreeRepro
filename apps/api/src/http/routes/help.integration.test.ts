import { randomUUID } from 'node:crypto';
import type { PermissionKey } from '@treerepro/contracts';
import { describe, expect, it } from 'vitest';
import { call, useTestApp } from '../../../test/helpers/app.ts';
import { lastAudit } from '../../../test/helpers/audit.ts';
import { adminRoleId, createRole } from '../../../test/helpers/roles.ts';
import { loginAs } from '../../../test/helpers/session.ts';
import { createUser } from '../../../test/helpers/users.ts';

interface Section {
  id: string;
  anchor: string | null;
  title: string;
  bodyHtml: string;
}
interface Topic {
  id: string;
  slug: string;
  title: string;
  summary: string;
  sections: Section[];
}

describe('RFC-73 R6–R8 help content', () => {
  const t = useTestApp();

  async function signedIn(permissions: PermissionKey[] = []) {
    const role = await createRole(t.db, { permissions });
    const { user } = await createUser(t.db, { roles: [role.id] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  async function admin() {
    const { user } = await createUser(t.db, { roles: [await adminRoleId(t.db)] });
    return { user, cookie: (await loginAs(t, user)).cookie };
  }

  /** A title no other test (or the seed) uses. */
  const unique = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

  async function newTopic(cookie: string, title = unique('Topic')): Promise<Topic> {
    const res = await call(t.app, 'POST', '/api/help', { cookie, body: { title } });
    expect(res.status).toBe(201);
    return (await res.json()).data as Topic;
  }

  async function newSection(cookie: string, topicId: string, body: object): Promise<Section> {
    const res = await call(t.app, 'POST', `/api/help/${topicId}/sections`, { cookie, body });
    expect(res.status).toBe(201);
    return (await res.json()).data as Section;
  }

  async function read(cookie: string, slug: string): Promise<Topic> {
    const res = await call(t.app, 'GET', `/api/help/${slug}`, { cookie });
    expect(res.status).toBe(200);
    return (await res.json()).data as Topic;
  }

  it('R6 every signed-in user reads the seeded topics, with no permission', async () => {
    const { cookie } = await signedIn();
    const index = await call(t.app, 'GET', '/api/help', { cookie });
    expect(index.status).toBe(200);
    const slugs = ((await index.json()).data as Topic[]).map((x) => x.slug);
    expect(slugs.slice(0, 8)).toEqual([
      'getting-started',
      'workflow',
      'vocabulary',
      'references',
      'scope',
      'contributions',
      'faq',
      'contact',
    ]);
    const workflow = await read(cookie, 'workflow');
    expect(workflow.sections.map((s) => s.anchor)).toEqual(
      expect.arrayContaining(['validate', 'contest', 'complement', 'withdraw']),
    );
  });

  // Plan 13j: the seed describes the revised record model (spec R-1, R-3, R-4,
  // R-11, R-13, §2), and every anchor a HelpTip or a help page links to exists.
  it('R2 the seed uses the revised record model and keeps the linked anchors (plan 13j)', async () => {
    const { cookie } = await signedIn();
    const retired = [
      /accepted value/i,
      /Add different record/,
      /\bNeutral\b/,
      /✓ Validate/,
      /one record per reference/i,
      /struck through/i,
    ];
    const linked: Record<string, string[]> = {
      workflow: ['validate', 'different', 'contest', 'complement', 'withdraw', 'review'],
      vocabulary: ['descriptions'],
      references: ['doi', 'book'],
      faq: ['download'],
      contact: ['what-to-send'],
    };
    const slugs = [
      'getting-started',
      'workflow',
      'vocabulary',
      'references',
      'scope',
      'contributions',
      'faq',
      'contact',
    ];
    const topics = new Map<string, Topic>();
    for (const slug of slugs) topics.set(slug, await read(cookie, slug));
    for (const [slug, topic] of topics) {
      const text = [topic.summary, ...topic.sections.flatMap((s) => [s.title, s.bodyHtml])].join(
        '\n',
      );
      for (const word of retired) expect(text, `${slug} still says ${word}`).not.toMatch(word);
      expect(
        topic.sections.map((s) => s.anchor),
        slug,
      ).toEqual(expect.arrayContaining(linked[slug] ?? []));
      // Links between help pages land on a seeded topic and section.
      for (const [, to, anchor] of text.matchAll(/href="\/app\/help\/([a-z-]+)(?:#([a-z-]+))?"/g)) {
        const target = topics.get(to as string);
        expect(target, `${slug} links to unknown topic ${to}`).toBeDefined();
        if (anchor)
          expect(
            target?.sections.map((s) => s.anchor),
            `${slug} → ${to}#${anchor}`,
          ).toContain(anchor);
      }
    }
  });

  it('R6 an unknown slug answers 404 HELP_TOPIC_NOT_FOUND', async () => {
    const { cookie } = await signedIn();
    const res = await call(t.app, 'GET', '/api/help/no-such-topic', { cookie });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('HELP_TOPIC_NOT_FOUND');
  });

  it('R6 a write without help.edit answers 403', async () => {
    const { cookie } = await signedIn(['dataset.read', 'records.review']);
    const res = await call(t.app, 'POST', '/api/help', { cookie, body: { title: unique('No') } });
    expect(res.status).toBe(403);
  });

  it('R6 a topic gets a slug from its title that survives a rename; a clash answers 409', async () => {
    const { user, cookie } = await admin();
    const suffix = randomUUID().slice(0, 8);
    const topic = await newTopic(cookie, `Plots & Sites ${suffix}`);
    expect(topic.slug).toBe(`plots-sites-${suffix}`);
    expect((await lastAudit(t.db, 'help.created', { targetId: topic.id }))?.actorUserId).toBe(
      user.id,
    );

    const renamed = await call(t.app, 'PATCH', `/api/help/${topic.id}`, {
      cookie,
      body: { title: 'Renamed', summary: 'One line.' },
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).data).toMatchObject({
      slug: topic.slug,
      title: 'Renamed',
      summary: 'One line.',
    });
    expect((await lastAudit(t.db, 'help.updated', { targetId: topic.id }))?.metadata).toEqual({
      fields: ['title', 'summary'],
      previous: { title: topic.title, summary: '' },
    });

    const clash = await call(t.app, 'POST', '/api/help', {
      cookie,
      body: { title: `plots sites ${suffix}` },
    });
    expect(clash.status).toBe(409);
    expect((await clash.json()).error.code).toBe('HELP_SLUG_TAKEN');
  });

  it('R6 sections get anchors, keep them on rename, and an untitled one has none', async () => {
    const { cookie } = await admin();
    const topic = await newTopic(cookie);
    const first = await newSection(cookie, topic.id, {
      title: 'How it works',
      bodyHtml: '<p>A</p>',
    });
    const untitled = await newSection(cookie, topic.id, { bodyHtml: '<p>B</p>' });
    expect(first.anchor).toBe('how-it-works');
    expect(untitled.anchor).toBeNull();

    const clash = await call(t.app, 'POST', `/api/help/${topic.id}/sections`, {
      cookie,
      body: { title: 'How it works!' },
    });
    expect(clash.status).toBe(409);
    expect((await clash.json()).error.code).toBe('HELP_ANCHOR_TAKEN');

    const edited = await call(t.app, 'PATCH', `/api/help/sections/${first.id}`, {
      cookie,
      body: { title: 'How it really works' },
    });
    expect(edited.status).toBe(200);
    expect((await edited.json()).data).toMatchObject({ anchor: 'how-it-works' });
    expect((await lastAudit(t.db, 'help.updated', { targetId: first.id }))?.metadata).toEqual({
      fields: ['title'],
      previous: { title: 'How it works', bodyHtml: first.bodyHtml },
    });
  });

  it('R6 position moves a section among its siblings', async () => {
    const { cookie } = await admin();
    const topic = await newTopic(cookie);
    const a = await newSection(cookie, topic.id, { title: 'A' });
    const b = await newSection(cookie, topic.id, { title: 'B' });
    const c = await newSection(cookie, topic.id, { title: 'C' });

    await call(t.app, 'PATCH', `/api/help/sections/${c.id}`, { cookie, body: { position: 0 } });
    expect((await read(cookie, topic.slug)).sections.map((s) => s.id)).toEqual([c.id, a.id, b.id]);

    await call(t.app, 'PATCH', `/api/help/sections/${c.id}`, { cookie, body: { position: 99 } });
    expect((await read(cookie, topic.slug)).sections.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
  });

  it('R6 position moves a topic on the index', async () => {
    const { cookie } = await admin();
    const topic = await newTopic(cookie);
    await call(t.app, 'PATCH', `/api/help/${topic.id}`, { cookie, body: { position: 0 } });
    const index = (await (await call(t.app, 'GET', '/api/help', { cookie })).json())
      .data as Topic[];
    expect(index[0]?.id).toBe(topic.id);
    await call(t.app, 'PATCH', `/api/help/${topic.id}`, { cookie, body: { position: 999 } });
  });

  it('R6 deleting a section or a topic removes it and is audited', async () => {
    const { cookie } = await admin();
    const topic = await newTopic(cookie);
    const section = await newSection(cookie, topic.id, { title: 'Gone soon' });

    const delSection = await call(t.app, 'DELETE', `/api/help/sections/${section.id}`, { cookie });
    expect(delSection.status).toBe(200);
    expect((await lastAudit(t.db, 'help.deleted', { targetId: section.id }))?.metadata).toEqual({
      title: 'Gone soon',
      previous: { anchor: 'gone-soon', title: 'Gone soon', bodyHtml: '' },
    });

    await newSection(cookie, topic.id, { title: 'Cascades', bodyHtml: '<p>Kept</p>' });
    const delTopic = await call(t.app, 'DELETE', `/api/help/${topic.id}`, { cookie });
    expect(delTopic.status).toBe(200);
    // The audit keeps the whole topic, so a deletion can be put back.
    expect((await lastAudit(t.db, 'help.deleted', { targetId: topic.id }))?.metadata).toEqual({
      title: topic.title,
      previous: {
        slug: topic.slug,
        title: topic.title,
        summary: '',
        sections: [{ anchor: 'cascades', title: 'Cascades', bodyHtml: '<p>Kept</p>' }],
      },
    });
    const gone = await call(t.app, 'GET', `/api/help/${topic.slug}`, { cookie });
    expect(gone.status).toBe(404);

    const again = await call(t.app, 'DELETE', `/api/help/sections/${section.id}`, { cookie });
    expect((await again.json()).error.code).toBe('HELP_SECTION_NOT_FOUND');
  });

  it('R8 the stored HTML keeps formatting and loses script, handlers and javascript: links', async () => {
    const { cookie } = await admin();
    const topic = await newTopic(cookie);
    const section = await newSection(cookie, topic.id, {
      title: 'Unsafe',
      bodyHtml:
        '<p onclick="steal()">Hi <strong>there</strong> <a href="/app/species">species</a>' +
        ' <a href="javascript:alert(1)">bad</a></p><script>alert(1)</script>' +
        '<iframe src="https://example.com"></iframe><ul><li><em>ok</em></li></ul>',
    });
    expect(section.bodyHtml).toBe(
      '<p>Hi <strong>there</strong> <a href="/app/species">species</a> <a>bad</a></p>' +
        '<ul><li><em>ok</em></li></ul>',
    );
  });
});
