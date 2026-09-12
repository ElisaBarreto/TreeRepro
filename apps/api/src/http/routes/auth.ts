import { inviteAcceptBodySchema, loginBodySchema, loginTotpBodySchema } from '@treerepro/contracts';
import { Hono } from 'hono';
import type { AuthContext } from '../../auth/context.ts';
import { acceptInvitation } from '../../auth/flows/invitation.ts';
import { auditLoginFailure, login, loginTotp } from '../../auth/flows/login.ts';
import { logout, logoutAll } from '../../auth/flows/session.ts';
import { RATE_LIMITS } from '../../auth/rate-limit.ts';
import { toAuthUser } from '../../auth/users.ts';
import { clientIp, userAgent } from '../client-ip.ts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import { emailIpKey, ipKey, rateLimit } from '../middleware/rate-limit.ts';
import {
  clearMfaCookie,
  clearSessionCookie,
  currentSession,
  currentUser,
  readMfaCookie,
  requireSession,
  setMfaCookie,
  setSessionCookie,
} from '../middleware/session.ts';
import { validate } from '../validate.ts';

/**
 * @rfc RFC-22 R1
 * @rfc RFC-20 R6
 */
export function authRoutes(ctx: AuthContext) {
  const tokenLimit = rateLimit(ctx.limiter, [
    { scope: 'token', rule: RATE_LIMITS.tokenIp, key: ipKey },
  ]);
  const loginLimit = rateLimit(
    ctx.limiter,
    [
      { scope: 'login:email', rule: RATE_LIMITS.loginEmailIp, key: emailIpKey },
      { scope: 'login:ip', rule: RATE_LIMITS.loginIp, key: ipKey },
    ],
    (c) =>
      auditLoginFailure(ctx, { reason: 'rate_limited', ip: clientIp(c), userAgent: userAgent(c) }),
  );
  // Keyed by the cookie's HMAC even after the challenge is gone (RFC-24 R3, R7);
  // a request without the cookie is limited by IP.
  const totpLimit = rateLimit(ctx.limiter, [
    {
      scope: 'login:totp',
      rule: RATE_LIMITS.loginTotp,
      key: (c) => {
        const raw = readMfaCookie(c);
        return raw ? ctx.mfa.challengeId(raw) : ipKey(c);
      },
    },
  ]);

  return new Hono<AppEnv>()
    .post('/invite/accept', tokenLimit, validate('json', inviteAcceptBodySchema), async (c) => {
      const body = c.req.valid('json');
      const { user, sessionRawId } = await acceptInvitation(ctx, {
        ...body,
        ip: clientIp(c),
        userAgent: userAgent(c),
      });
      setSessionCookie(c, sessionRawId);
      return c.json({ data: { user: toAuthUser(user) } });
    })
    .post('/login', loginLimit, validate('json', loginBodySchema), async (c) => {
      const body = c.req.valid('json');
      const result = await login(ctx, { ...body, ip: clientIp(c), userAgent: userAgent(c) });
      if (result.status === 'totp_required') {
        setMfaCookie(c, result.mfaRawId);
        return c.json({ data: { status: 'totp_required' as const } });
      }
      setSessionCookie(c, result.sessionRawId);
      return c.json({ data: { status: 'ok' as const, user: toAuthUser(result.user) } });
    })
    .post('/login/totp', totpLimit, validate('json', loginTotpBodySchema), async (c) => {
      const body = c.req.valid('json');
      try {
        const { user, sessionRawId } = await loginTotp(ctx, {
          mfaRawId: readMfaCookie(c),
          ...body,
          ip: clientIp(c),
          userAgent: userAgent(c),
        });
        clearMfaCookie(c);
        setSessionCookie(c, sessionRawId);
        return c.json({ data: { status: 'ok' as const, user: toAuthUser(user) } });
      } catch (err) {
        if (err instanceof AppError && err.code === 'AUTH_MFA_EXPIRED') clearMfaCookie(c);
        throw err;
      }
    })
    .post('/logout', requireSession, async (c) => {
      await logout(ctx, {
        user: currentUser(c),
        session: currentSession(c),
        ip: clientIp(c),
        userAgent: userAgent(c),
      });
      clearSessionCookie(c);
      return c.json({ data: { status: 'ok' as const } });
    })
    .post('/logout-all', requireSession, async (c) => {
      await logoutAll(ctx, { user: currentUser(c), ip: clientIp(c), userAgent: userAgent(c) });
      clearSessionCookie(c);
      return c.json({ data: { status: 'ok' as const } });
    })
    .get('/me', requireSession, (c) =>
      c.json({ data: { user: toAuthUser(currentUser(c)), permissions: [] as string[] } }),
    );
}
