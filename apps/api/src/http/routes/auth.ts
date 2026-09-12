import {
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  inviteAcceptBodySchema,
  loginBodySchema,
  loginTotpBodySchema,
  resetPasswordBodySchema,
  totpConfirmBodySchema,
  totpDisableBodySchema,
} from '@treerepro/contracts';
import { Hono } from 'hono';
import { resolvePermissions } from '../../access/permissions.ts';
import type { AuthContext } from '../../auth/context.ts';
import { acceptInvitation } from '../../auth/flows/invitation.ts';
import { auditLoginFailure, login, loginTotp } from '../../auth/flows/login.ts';
import { changePassword, forgotPassword, resetPassword } from '../../auth/flows/password.ts';
import { logout, logoutAll } from '../../auth/flows/session.ts';
import { confirmTotpSetup, disableTotp, startTotpSetup } from '../../auth/flows/totp.ts';
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
 * @rfc RFC-32 R6
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
  const forgotLimit = rateLimit(ctx.limiter, [
    { scope: 'forgot:email', rule: RATE_LIMITS.forgotEmailIp, key: emailIpKey },
    { scope: 'forgot:ip', rule: RATE_LIMITS.forgotIp, key: ipKey },
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
    .get('/me', requireSession, async (c) => {
      const user = currentUser(c);
      const permissions = [...(await resolvePermissions(ctx, user.id))].sort();
      return c.json({ data: { user: toAuthUser(user), permissions } });
    })
    .post(
      '/password/forgot',
      forgotLimit,
      validate('json', forgotPasswordBodySchema),
      async (c) => {
        await forgotPassword(ctx, {
          ...c.req.valid('json'),
          ip: clientIp(c),
          userAgent: userAgent(c),
        });
        return c.json({ data: { status: 'sent' as const } });
      },
    )
    .post('/password/reset', tokenLimit, validate('json', resetPasswordBodySchema), async (c) => {
      await resetPassword(ctx, {
        ...c.req.valid('json'),
        ip: clientIp(c),
        userAgent: userAgent(c),
      });
      return c.json({ data: { status: 'ok' as const } });
    })
    .post(
      '/password/change',
      requireSession,
      validate('json', changePasswordBodySchema),
      async (c) => {
        await changePassword(ctx, {
          user: currentUser(c),
          session: currentSession(c),
          ...c.req.valid('json'),
          ip: clientIp(c),
          userAgent: userAgent(c),
        });
        return c.json({ data: { status: 'ok' as const } });
      },
    )
    .post('/totp/setup', requireSession, async (c) =>
      c.json({ data: await startTotpSetup(ctx, currentUser(c)) }),
    )
    .post('/totp/confirm', requireSession, validate('json', totpConfirmBodySchema), async (c) =>
      c.json({
        data: await confirmTotpSetup(ctx, {
          user: currentUser(c),
          ...c.req.valid('json'),
          ip: clientIp(c),
          userAgent: userAgent(c),
        }),
      }),
    )
    .post('/totp/disable', requireSession, validate('json', totpDisableBodySchema), async (c) => {
      await disableTotp(ctx, {
        user: currentUser(c),
        ...c.req.valid('json'),
        ip: clientIp(c),
        userAgent: userAgent(c),
      });
      return c.json({ data: { status: 'ok' as const } });
    });
}
