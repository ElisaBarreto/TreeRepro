import { sql } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** @rfc RFC-73 R6 */
export const helpTopics = pgTable('help_topics', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  position: integer('position').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** @rfc RFC-73 R6 */
export const helpSections = pgTable(
  'help_sections',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => helpTopics.id, { onDelete: 'cascade' }),
    anchor: text('anchor'),
    title: text('title').notNull().default(''),
    bodyHtml: text('body_html').notNull().default(''),
    position: integer('position').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('help_sections_topic_anchor_idx').on(t.topicId, t.anchor)],
);
