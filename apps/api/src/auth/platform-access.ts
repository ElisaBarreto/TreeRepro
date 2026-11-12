import { PLATFORM_NAMES, PLATFORMS, type Platform } from '@treerepro/contracts';
import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { AppError } from '../http/errors.ts';

/** The platforms a user holds at least one role on, in `PLATFORMS` order. @rfc RFC-22 R13 */
export async function platformsHeld(db: DbExecutor, userId: string): Promise<Platform[]> {
  const rows = await db
    .selectDistinct({ platform: userRoles.platform })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return PLATFORMS.filter((p) => rows.some((r) => r.platform === p));
}

/** Why a verified user may not use the request's platform. @rfc RFC-22 R13 */
export type PlatformDenialReason = 'no_role' | 'other_platform';

/**
 * The 403 of RFC-22 R13: `details` name the platforms the user does hold a
 * role on, so the web app can point to the other one.
 * @rfc RFC-22 R13
 */
export class PlatformDeniedError extends AppError {
  readonly userId: string;
  readonly platform: Platform;
  readonly reason: PlatformDenialReason;
  constructor(input: {
    userId: string;
    platform: Platform;
    reason: PlatformDenialReason;
    held: Platform[];
  }) {
    super(
      'PLATFORM_ACCESS_DENIED',
      `You have no access to ${PLATFORM_NAMES[input.platform]}`,
      input.held.map((p) => ({ path: 'platforms', message: p })),
    );
    this.name = 'PlatformDeniedError';
    this.userId = input.userId;
    this.platform = input.platform;
    this.reason = input.reason;
  }
}

/**
 * Throws `PlatformDeniedError` (`no_role`) when the user holds no role on
 * `platform`. Run only once the credentials are verified.
 * @rfc RFC-22 R13
 */
export async function assertHoldsPlatform(
  db: DbExecutor,
  userId: string,
  platform: Platform,
): Promise<void> {
  const held = await platformsHeld(db, userId);
  if (!held.includes(platform))
    throw new PlatformDeniedError({ userId, platform, reason: 'no_role', held });
}
