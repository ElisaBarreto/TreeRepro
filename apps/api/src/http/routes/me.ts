import { updateMeBodySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import { updateOwnName } from '../../admin/users.ts';
import type { AuthContext } from '../../auth/context.ts';
import { listSessions, revokeOwnSession } from '../../auth/flows/session.ts';
import { clientIp, userAgent } from '../client-ip.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import { currentSession, currentUser, requireSession } from '../middleware/session.ts';
import { validate } from '../validate.ts';

const sessionIdParam = z.strictObject({ id: z.string().regex(/^[0-9a-f]{64}$/) });

/**
 * @rfc RFC-22 R11
 * @rfc RFC-50 R11
 */
export function meRoutes(ctx: AuthContext) {
  return new Hono<AppEnv>()
    .patch('/', requireSession, validate('json', updateMeBodySchema), async (c) =>
      c.json({
        data: await updateOwnName(ctx, {
          user: currentUser(c),
          name: c.req.valid('json').name,
          ip: clientIp(c),
          userAgent: userAgent(c),
        }),
      }),
    )
    .get('/sessions', requireSession, async (c) =>
      c.json({ data: await listSessions(ctx, currentUser(c), currentSession(c).id) }),
    )
    .delete('/sessions/:id', requireSession, validate('param', sessionIdParam), async (c) => {
      const { id } = c.req.valid('param');
      const revoked = await revokeOwnSession(ctx, {
        user: currentUser(c),
        id,
        ip: clientIp(c),
        userAgent: userAgent(c),
      });
      if (!revoked) throw new AppError('NOT_FOUND', 'Session not found');
      return c.json({ data: { status: 'ok' as const } });
    });
}
