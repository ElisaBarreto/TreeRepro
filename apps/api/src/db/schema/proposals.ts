import type { Lookup } from '@treerepro/contracts';
import { PROPOSAL_STATUSES } from '@treerepro/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { species } from './taxa.ts';
import { users } from './users.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * A contributor's request to add a species not yet in the catalog. It is
 * checked against GBIF/WCVP (RFC-81) at submission time and the result is
 * stored on the row rather than recomputed later, so a reviewer always sees
 * what was true when the proposal was made.
 *
 * `status = 'open'` if and only if `decided_at is null`, and
 * `status = 'approved'` if and only if `species_id is not null` — the two
 * CHECK constraints keep the lifecycle columns from drifting apart. The
 * partial unique index on `lower(proposed_name)` scoped to `status = 'open'`
 * stops a second open proposal for the same name (case-insensitively); once
 * a proposal is decided its name is free again.
 * @rfc RFC-75 R1
 */
export const speciesProposals = pgTable(
  'species_proposals',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    proposedName: text('proposed_name').notNull(),
    note: text('note'),
    proposerId: uuid('proposer_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: PROPOSAL_STATUSES }).notNull().default('open'),
    lookup: jsonb('lookup').$type<Lookup>(),
    lookupAt: ts('lookup_at'),
    speciesId: uuid('species_id').references(() => species.id, { onDelete: 'restrict' }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('species_proposals_open_name_idx')
      .on(sql`lower(${t.proposedName})`)
      .where(sql`${t.status} = 'open'`),
    index('species_proposals_status_idx').on(t.status, t.id.desc()),
    index('species_proposals_proposer_idx').on(t.proposerId, t.id.desc()),
    check('species_proposals_status_check', sql`${t.status} in ('open', 'approved', 'rejected')`),
    check('species_proposals_open_check', sql`(${t.status} = 'open') = (${t.decidedAt} is null)`),
    check(
      'species_proposals_approved_check',
      sql`(${t.status} = 'approved') = (${t.speciesId} is not null)`,
    ),
  ],
);

export type SpeciesProposalRow = typeof speciesProposals.$inferSelect;
export type NewSpeciesProposalRow = typeof speciesProposals.$inferInsert;
