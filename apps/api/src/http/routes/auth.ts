import { inviteAcceptBodySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../auth/context.ts';
import { acceptInvitation } from '../../auth/flows/invitation.ts';
import { RATE_LIMITS } from '../../auth/rate-limit.ts';
import { toAuthUser } from '../../auth/users.ts';
import { clientIp, userAgent } from '../client-ip.ts';
import type { AppEnv } from '../env.ts';
import { ipKey, rateLimit } from '../middleware/rate-limit.ts';
import { setSessionCookie } from '../middleware/session.ts';
import { validate } from '../validate.ts';

/**
 * @rfc RFC-22 R1
 * @rfc RFC-20 R6
 */
export function authRoutes(ctx: AuthContext) {
  const tokenLimit = rateLimit(ctx.limiter, [
    { scope: 'token', rule: RATE_LIMITS.tokenIp, key: ipKey },
  ]);

  return new Hono<AppEnv>().post(
    '/invite/accept',
    tokenLimit,
    validate('json', inviteAcceptBodySchema),
    async (c) => {
      const body = c.req.valid('json');
      const { user, sessionRawId } = await acceptInvitation(ctx, {
        ...body,
        ip: clientIp(c),
        userAgent: userAgent(c),
      });
      setSessionCookie(c, sessionRawId);
      return c.json({ data: { user: toAuthUser(user) } });
    },
  );
}
