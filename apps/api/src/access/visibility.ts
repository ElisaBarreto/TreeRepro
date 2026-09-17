import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { traitLevels, traits } from '../db/schema/dictionary.ts';
import { species } from '../db/schema/taxa.ts';
import type { AppEnv } from '../http/env.ts';
import { currentPermissions } from '../http/middleware/require-permission.ts';
import type { AccessContext } from './context.ts';

/**
 * What one viewer may see (RFC-33 R1). `plotIds` stays null until plan 08b
 * reads the viewer's plot settings.
 * @rfc RFC-33 R1
 */
export interface Visibility {
  inactive: boolean;
  plotIds: string[] | null;
}

/** A viewer who sees everything: CLI commands, migrations, admin-only services. @rfc RFC-33 R1 */
export const UNRESTRICTED: Visibility = { inactive: true, plotIds: null };

/** @rfc RFC-33 R1 */
export function visibilityFor(permissions: ReadonlySet<string>): Visibility {
  return { inactive: permissions.has('dataset.read_inactive'), plotIds: null };
}

/** The viewer of the current request; computed once and kept on the context. @rfc RFC-33 R1 */
export async function visibilityOf(_ctx: AccessContext, c: Context<AppEnv>): Promise<Visibility> {
  const cached = c.get('visibility');
  if (cached) return cached;
  const v = visibilityFor(currentPermissions(c));
  c.set('visibility', v);
  return v;
}

/** `species` row predicate; `alias` lets a joined alias be used instead of the table. @rfc RFC-33 R2 */
export function speciesVisible(
  v: Visibility,
  activeCol: SQL | typeof species.active = species.active,
): SQL {
  return v.inactive ? sql`true` : sql`${activeCol}`;
}

/** @rfc RFC-33 R2 */
export function traitVisible(
  v: Visibility,
  activeCol: SQL | typeof traits.active = traits.active,
): SQL {
  return v.inactive ? sql`true` : sql`${activeCol}`;
}

/** @rfc RFC-33 R2 */
export function levelVisible(
  v: Visibility,
  activeCol: SQL | typeof traitLevels.active = traitLevels.active,
): SQL {
  return v.inactive ? sql`true` : sql`${activeCol}`;
}
