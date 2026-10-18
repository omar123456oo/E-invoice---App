import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { mount, route } from '../../common/http/route.js';
import * as auth from './auth.service.js';
import { PasswordSchema } from './password.js';

export const REFRESH_COOKIE = 'rt';
const COOKIE_PATH = '/api/v1/auth';

function client(req: Request): auth.ClientInfo {
  return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 512), requestId: req.requestId };
}

function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'strict',
    path: COOKIE_PATH,
    expires,
  });
}

/** Cookie-authenticated endpoints additionally require a custom header (CSRF defence in depth). */
function requireCsrfHeader(req: Request): void {
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') throw AppError.forbidden('Missing required header', 'CSRF_HEADER_MISSING');
}

const TokenResponse = z.object({ accessToken: z.string(), expiresIn: z.number() });

export function authRouter(): Router {
  const router = Router();
  mount(router, '/auth', [
    route({
      method: 'post', path: '/login', tag: 'Auth', auth: false, summary: 'Sign in with email and password (and TOTP code when MFA is enabled)',
      body: z.object({ email: z.email().max(254), password: z.string().min(1).max(128), totp: z.string().regex(/^\d{6}$/).optional() }),
      response: TokenResponse.extend({ user: z.any() }),
      handler: async ({ body, req, res }) => {
        const result = await auth.login(body.email, body.password, body.totp, client(req));
        setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
        return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
      },
    }),
    route({
      method: 'post', path: '/refresh', tag: 'Auth', auth: false, summary: 'Rotate the refresh-token cookie and obtain a new access token',
      response: TokenResponse,
      handler: async ({ req, res }) => {
        requireCsrfHeader(req);
        const token = req.cookies?.[REFRESH_COOKIE];
        if (typeof token !== 'string' || !token) throw AppError.unauthorized('No session', 'NO_SESSION');
        const pair = await auth.refresh(token, client(req));
        setRefreshCookie(res, pair.refreshToken, pair.refreshExpiresAt);
        return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
      },
    }),
    route({
      method: 'post', path: '/logout', tag: 'Auth', summary: 'Revoke the current session',
      handler: async ({ ctx, res }) => {
        await auth.logout(ctx);
        res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
        return undefined;
      },
    }),
    route({ method: 'get', path: '/me', tag: 'Auth', summary: 'Current user, permissions and branch access', handler: async ({ ctx }) => auth.me(ctx) }),
    route({ method: 'get', path: '/sessions', tag: 'Auth', summary: 'List my active sessions', handler: async ({ ctx }) => auth.listSessions(ctx) }),
    route({
      method: 'delete', path: '/sessions/:sessionId', tag: 'Auth', summary: 'Revoke one of my sessions',
      params: z.object({ sessionId: z.uuid() }),
      handler: async ({ ctx, params }) => auth.revokeSession(ctx, params.sessionId),
    }),
    route({
      method: 'post', path: '/password/change', tag: 'Auth', summary: 'Change my password (revokes other sessions)',
      body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: PasswordSchema }),
      handler: async ({ ctx, body }) => auth.changePassword(ctx, body.currentPassword, body.newPassword),
    }),
    route({
      method: 'post', path: '/password/forgot', tag: 'Auth', auth: false, status: 202, summary: 'Request a password reset email',
      body: z.object({ email: z.email().max(254) }),
      handler: async ({ body, req }) => {
        const base = `${env().CORS_ORIGINS[0] ?? ''}/reset-password`;
        await auth.requestPasswordReset(body.email, base, client(req));
        return { accepted: true };
      },
    }),
    route({
      method: 'post', path: '/password/reset', tag: 'Auth', auth: false, summary: 'Reset password using an emailed token',
      body: z.object({ token: z.string().min(20).max(200), newPassword: PasswordSchema }),
      handler: async ({ body, req }) => auth.resetPassword(body.token, body.newPassword, client(req)),
    }),
    route({ method: 'post', path: '/mfa/setup', tag: 'Auth', summary: 'Begin TOTP enrollment', handler: async ({ ctx }) => auth.beginMfaEnrollment(ctx) }),
    route({
      method: 'post', path: '/mfa/confirm', tag: 'Auth', summary: 'Confirm TOTP enrollment with a code',
      body: z.object({ code: z.string().regex(/^\d{6}$/) }),
      handler: async ({ ctx, body }) => auth.confirmMfaEnrollment(ctx, body.code),
    }),
    route({
      method: 'post', path: '/mfa/disable', tag: 'Auth', summary: 'Turn off TOTP (requires password and a current code)',
      body: z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }),
      handler: async ({ ctx, body }) => auth.disableMfa(ctx, body.password, body.code),
    }),
  ]);
  return router;
}
