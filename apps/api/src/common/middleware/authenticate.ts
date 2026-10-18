import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';
import { ALL_BRANCH_ROLES, permissionsFor, type Role } from '../security/permissions.js';
import { UserModel } from '../../modules/users/user.model.js';
import { SessionModel } from '../../modules/auth/session.model.js';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  tid: string | null;
  role: Role;
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env().JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'ereceipt-api',
      audience: 'ereceipt-web',
    }) as AccessTokenClaims;
  } catch {
    throw AppError.unauthorized('Invalid or expired access token', 'INVALID_TOKEN');
  }
}

/**
 * Verifies the bearer token, then confirms the session is not revoked and the
 * user is still active, so deactivation and logout take effect immediately.
 * Role and branch assignments are read from the database, not the token.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
  const claims = verifyAccessToken(header.slice(7));

  const [session, user] = await Promise.all([
    SessionModel.findById(claims.sid).lean(),
    UserModel.findOne({ _id: claims.sub }).setOptions({ skipTenantGuard: true }).lean(),
  ]);
  if (!session || session.revokedAt || session.expiresAt < new Date() || String(session.userId) !== claims.sub) {
    throw AppError.unauthorized('Session is no longer valid', 'SESSION_REVOKED');
  }
  if (!user || !user.isActive) throw AppError.unauthorized('Account is inactive', 'ACCOUNT_INACTIVE');

  const role = user.role as Role;
  req.ctx = {
    userId: new Types.ObjectId(String(user._id)),
    tenantId: user.tenantId ? new Types.ObjectId(String(user.tenantId)) : null,
    role,
    permissions: permissionsFor(role),
    branchIds: ALL_BRANCH_ROLES.has(role) ? 'ALL' : (user.branchIds ?? []).map((b) => new Types.ObjectId(String(b))),
    sessionId: claims.sid,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 512),
  };
  next();
}
