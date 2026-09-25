import type {
  CreateHelpSectionBody,
  CreateHelpTopicBody,
  HelpSection,
  HelpTopic,
  HelpTopicSummary,
  UpdateHelpSectionBody,
  UpdateHelpTopicBody,
} from '@treerepro/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import sanitizeHtml from 'sanitize-html';
import { recordAudit } from '../audit/audit.ts';
import type { DbExecutor } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { helpSections, helpTopics } from '../db/schema/help.ts';
import { AppError } from '../http/errors.ts';

/**
 * The slug or anchor a title generates: lowercase ASCII, accents dropped,
 * every other run of characters a single `-` (RFC-73 R6).
 * @rfc RFC-73 R6
 */
export function helpSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The HTML a section may store: formatting, links, images and tables; no
 * script, style, frame, event handler or `javascript:` URL (RFC-73 R8).
 * @rfc RFC-73 R8
 */
export function sanitizeHelpHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['id'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

function slugOrFail(title: string, path: string): string {
  const slug = helpSlug(title);
  if (!slug)
    throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
      { path, message: 'The title needs at least one letter or digit' },
    ]);
  return slug;
}

const topicColumns = {
  id: helpTopics.id,
  slug: helpTopics.slug,
  title: helpTopics.title,
  summary: helpTopics.summary,
};
const sectionColumns = {
  id: helpSections.id,
  anchor: helpSections.anchor,
  title: helpSections.title,
  bodyHtml: helpSections.bodyHtml,
};

async function audit(
  db: DbExecutor,
  actorId: string,
  action: 'help.created' | 'help.updated' | 'help.deleted',
  targetType: 'help_topics' | 'help_sections',
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await recordAudit(db, { actorUserId: actorId, action, targetType, targetId, metadata });
}

/** Every topic in index order (RFC-73 R2). @rfc RFC-73 R2, R6 */
export async function listHelpTopics(db: DbExecutor): Promise<HelpTopicSummary[]> {
  return db.select(topicColumns).from(helpTopics).orderBy(asc(helpTopics.position));
}

async function topicWithSections(db: DbExecutor, where: ReturnType<typeof eq>): Promise<HelpTopic> {
  const [topic] = await db.select(topicColumns).from(helpTopics).where(where).limit(1);
  if (!topic) throw new AppError('HELP_TOPIC_NOT_FOUND', 'Help topic not found');
  const sections = await db
    .select(sectionColumns)
    .from(helpSections)
    .where(eq(helpSections.topicId, topic.id))
    .orderBy(asc(helpSections.position));
  return { ...topic, sections };
}

/** One topic by slug with its sections in order. @rfc RFC-73 R2, R6 */
export function getHelpTopic(db: DbExecutor, slug: string): Promise<HelpTopic> {
  return topicWithSections(db, eq(helpTopics.slug, slug));
}

/**
 * Moves one row to `position` (0-based, clamped) among the rows `scope`
 * selects, renumbering them all 0..n-1 (RFC-73 R6).
 */
async function move(
  tx: DbExecutor,
  table: typeof helpTopics | typeof helpSections,
  scope: ReturnType<typeof eq> | undefined,
  id: string,
  position: number,
): Promise<void> {
  const rows = await tx
    .select({ id: table.id })
    .from(table)
    .where(scope)
    .orderBy(asc(table.position), asc(table.createdAt));
  const ids = rows.map((r) => r.id).filter((x) => x !== id);
  ids.splice(Math.min(position, ids.length), 0, id);
  for (const [i, rowId] of ids.entries())
    await tx.update(table).set({ position: i }).where(eq(table.id, rowId));
}

/** @rfc RFC-73 R6 */
export async function createHelpTopic(
  db: DbExecutor,
  input: CreateHelpTopicBody & { actorId: string },
): Promise<HelpTopic> {
  const slug = slugOrFail(input.title, 'title');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(helpTopics)
      .values({
        slug,
        title: input.title,
        summary: input.summary ?? '',
        position: sql`(select coalesce(max(position) + 1, 0) from help_topics)`,
      })
      .onConflictDoNothing()
      .returning({ id: helpTopics.id });
    if (!row) throw new AppError('HELP_SLUG_TAKEN', 'Another help topic has this slug');
    await audit(tx, input.actorId, 'help.created', 'help_topics', row.id);
    return topicWithSections(tx, eq(helpTopics.id, row.id));
  });
}

async function topicRow(db: DbExecutor, id: string) {
  const [row] = await db.select().from(helpTopics).where(eq(helpTopics.id, id)).limit(1);
  if (!row) throw new AppError('HELP_TOPIC_NOT_FOUND', 'Help topic not found');
  return row;
}

async function sectionRow(db: DbExecutor, id: string) {
  const [row] = await db.select().from(helpSections).where(eq(helpSections.id, id)).limit(1);
  if (!row) throw new AppError('HELP_SECTION_NOT_FOUND', 'Help section not found');
  return row;
}

/** @rfc RFC-73 R6 */
export async function updateHelpTopic(
  db: DbExecutor,
  input: UpdateHelpTopicBody & { id: string; actorId: string },
): Promise<HelpTopic> {
  return db.transaction(async (tx) => {
    const row = await topicRow(tx, input.id);
    const set: Partial<typeof helpTopics.$inferInsert> = {};
    const fields: string[] = [];
    if (input.title !== undefined && input.title !== row.title) {
      set.title = input.title;
      fields.push('title');
    }
    if (input.summary !== undefined && input.summary !== row.summary) {
      set.summary = input.summary;
      fields.push('summary');
    }
    if (input.position !== undefined) {
      await move(tx, helpTopics, undefined, row.id, input.position);
      fields.push('position');
    }
    if (fields.length > 0) {
      await tx
        .update(helpTopics)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(helpTopics.id, row.id));
      await audit(tx, input.actorId, 'help.updated', 'help_topics', row.id, { fields });
    }
    return topicWithSections(tx, eq(helpTopics.id, row.id));
  });
}

/** @rfc RFC-73 R6 */
export async function deleteHelpTopic(
  db: DbExecutor,
  input: { id: string; actorId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await topicRow(tx, input.id);
    await tx.delete(helpTopics).where(eq(helpTopics.id, row.id));
    await audit(tx, input.actorId, 'help.deleted', 'help_topics', row.id, { title: row.title });
  });
}

/** @rfc RFC-73 R6, R8 */
export async function createHelpSection(
  db: DbExecutor,
  input: CreateHelpSectionBody & { topicId: string; actorId: string },
): Promise<HelpSection> {
  const title = input.title ?? '';
  const anchor = title ? slugOrFail(title, 'title') : null;
  return db.transaction(async (tx) => {
    await topicRow(tx, input.topicId);
    let row: HelpSection | undefined;
    try {
      [row] = await tx
        .insert(helpSections)
        .values({
          topicId: input.topicId,
          anchor,
          title,
          bodyHtml: sanitizeHelpHtml(input.bodyHtml ?? ''),
          position: sql`(select coalesce(max(position) + 1, 0) from help_sections where topic_id = ${input.topicId})`,
        })
        .returning(sectionColumns);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError('HELP_ANCHOR_TAKEN', 'The topic already has a section with this anchor');
      throw err;
    }
    if (!row) throw new Error('createHelpSection: insert returned no row');
    await audit(tx, input.actorId, 'help.created', 'help_sections', row.id);
    return row;
  });
}

/** @rfc RFC-73 R6, R8 */
export async function updateHelpSection(
  db: DbExecutor,
  input: UpdateHelpSectionBody & { id: string; actorId: string },
): Promise<HelpSection> {
  return db.transaction(async (tx) => {
    const row = await sectionRow(tx, input.id);
    const set: Partial<typeof helpSections.$inferInsert> = {};
    const fields: string[] = [];
    if (input.title !== undefined && input.title !== row.title) {
      set.title = input.title;
      fields.push('title');
    }
    if (input.bodyHtml !== undefined) {
      const bodyHtml = sanitizeHelpHtml(input.bodyHtml);
      if (bodyHtml !== row.bodyHtml) {
        set.bodyHtml = bodyHtml;
        fields.push('bodyHtml');
      }
    }
    if (input.position !== undefined) {
      await move(tx, helpSections, eq(helpSections.topicId, row.topicId), row.id, input.position);
      fields.push('position');
    }
    if (fields.length > 0) {
      await tx
        .update(helpSections)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(helpSections.id, row.id));
      await audit(tx, input.actorId, 'help.updated', 'help_sections', row.id, { fields });
    }
    const [updated] = await tx
      .select(sectionColumns)
      .from(helpSections)
      .where(eq(helpSections.id, row.id));
    if (!updated) throw new Error('updateHelpSection: row vanished');
    return updated;
  });
}

/** @rfc RFC-73 R6 */
export async function deleteHelpSection(
  db: DbExecutor,
  input: { id: string; actorId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await sectionRow(tx, input.id);
    await tx.delete(helpSections).where(eq(helpSections.id, row.id));
    await audit(tx, input.actorId, 'help.deleted', 'help_sections', row.id, { title: row.title });
  });
}
