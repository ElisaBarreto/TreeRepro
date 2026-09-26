import { createApiKeyBodySchema, updateMeBodySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import { updateOwnName } from '../../admin/users.ts';
import { createApiKey, listApiKeys, revokeApiKey } from '../../auth/api-keys.ts';
import type { AuthContext } from '../../auth/context.ts';
import { listSessions, revokeOwnSession } from '../../auth/flows/session.ts';
import { RATE_LIMITS } from '../../auth/rate-limit.ts';
import { clientIp, userAgent } from '../client-ip.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import { rateLimit } from '../middleware/rate-limit.ts';
import { currentSession, currentUser, requireSession } from '../middleware/session.ts';
import { validate } from '../validate.ts';

const sessionIdParam = z.strictObject({ id: z.string().regex(/^[0-9a-f]{64}$/) });

/**
 * @rfc RFC-22 R11
 * @rfc RFC-50 R11
 * @rfc RFC-82 R2, R6, R7
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
    })
    .get('/api-keys', requireSession, async (c) =>
      c.json({ data: await listApiKeys(ctx, currentUser(c)) }),
    )
    .post(
      '/api-keys',
      requireSession,
      rateLimit(ctx.limiter, [
        {
          scope: 'apiKeyCreate',
          rule: RATE_LIMITS.apiKeyCreate,
          key: (c) => c.get('user')?.id ?? null,
        },
      ]),
      validate('json', createApiKeyBodySchema),
      async (c) =>
        c.json({
          data: await createApiKey(ctx, {
            user: currentUser(c),
            ...c.req.valid('json'),
            ip: clientIp(c),
            userAgent: userAgent(c),
          }),
        }),
    )
    .delete(
      '/api-keys/:id',
      requireSession,
      validate('param', z.strictObject({ id: z.uuid() })),
      async (c) => {
        await revokeApiKey(ctx, {
          user: currentUser(c),
          id: c.req.valid('param').id,
          ip: clientIp(c),
          userAgent: userAgent(c),
        });
        return c.json({ data: { status: 'ok' as const } });
      },
    );
}
