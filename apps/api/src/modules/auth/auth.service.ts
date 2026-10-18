import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { authenticator } from 'otplib';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from '../../common/crypto/crypto.js';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestContext } from '../../common/security/context.js';
import { permissionsFor, type Role } from '../../common/security/permissions.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { getMailer } from '../notifications/mailer.js';
import { UserModel } from '../users/user.model.js';
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from './password.js';
import { PasswordResetModel, SessionModel } from './session.model.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;

export interface ClientInfo {
  ip: string | undefined;
  userAgent: string | undefined;
  requestId: string;
}

export interface TokenPair {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

function signAccessToken(user: { _id: unknown; tenantId?: unknown; role: string }, sessionId: string): string {
  return jwt.sign(
    { sid: sessionId, tid: user.tenantId ? String(user.tenantId) : null, role: user.role },
    env().JWT_ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: env().ACCESS_TOKEN_TTL_SECONDS, subject: String(user._id), issuer: 'ereceipt-api', audience: 'ereceipt-web' },
  );
}

const anon = (client: ClientInfo) => ({ actor: { userId: null, role: null, type: 'anonymous' as const }, requestId: client.requestId, ip: client.ip });

export async function login(email: string, password: string, totp: string | undefined, client: ClientInfo): Promise<TokenPair & { user: unknown }> {
  const user = await UserModel.findOne({ email: email.toLowerCase().trim() })
    .select('+passwordHash +failedLoginCount +lockedUntil +mfa.secretEnc')
    .setOptions({ skipTenantGuard: true });

  if (!user) {
    await verifyPassword(await getDummyHash(), password);
    await recordAudit({ ...anon(client), action: 'auth.login', outcome: 'failure', summary: 'Unknown account' });
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const auditBase = { tenantId: user.tenantId, actor: { userId: user._id, role: user.role, type: 'user' as const }, requestId: client.requestId, ip: client.ip, entityType: 'User', entityId: user._id };

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAudit({ ...auditBase, action: 'auth.login', outcome: 'failure', summary: 'Account locked' });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked after repeated failed sign-in attempts');
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk || !user.isActive) {
    const failed = (user.failedLoginCount ?? 0) + 1;
    await UserModel.updateOne(
      { _id: user._id, tenantId: user.tenantId },
      failed >= MAX_FAILED_LOGINS
        ? { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } }
        : { $set: { failedLoginCount: failed } },
    ).setOptions({ skipTenantGuard: true });
    await recordAudit({ ...auditBase, action: 'auth.login', outcome: 'failure', summary: passwordOk ? 'Inactive account' : 'Wrong password' });
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  if (user.mfa?.enabled) {
    if (!totp) throw AppError.unauthorized('A verification code is required', 'MFA_REQUIRED');
    const secret = decryptSecret(user.mfa.secretEnc as string);
    if (!authenticator.check(totp, secret)) {
      await recordAudit({ ...auditBase, action: 'auth.login', outcome: 'failure', summary: 'Invalid MFA code' });
      throw AppError.unauthorized('Invalid verification code', 'MFA_INVALID');
    }
  }

  const rehash = needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(password) } : {};
  await UserModel.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), ...rehash } }).setOptions({ skipTenantGuard: true });
  const pair = await createSession(user, client);
  await recordAudit({ ...auditBase, action: 'auth.login', summary: 'Signed in' });
  return { ...pair, user: user.toJSON() };
}

async function createSession(user: { _id: Types.ObjectId; tenantId?: Types.ObjectId | null; role: string }, client: ClientInfo): Promise<TokenPair> {
  const sessionId = randomUUID();
  const refreshToken = randomToken(48);
  const refreshExpiresAt = new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await SessionModel.create({
    _id: sessionId,
    userId: user._id,
    tenantId: user.tenantId ?? null,
    refreshTokenHash: sha256Hex(refreshToken),
    expiresAt: refreshExpiresAt,
    ip: client.ip ?? null,
    userAgent: client.userAgent ?? null,
  });
  return { accessToken: signAccessToken(user, sessionId), expiresIn: env().ACCESS_TOKEN_TTL_SECONDS, refreshToken, refreshExpiresAt };
}

/**
 * Rotates the refresh token. Reuse of an already-rotated token indicates
 * theft; the whole session is revoked.
 */
export async function refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
  const hash = sha256Hex(refreshToken);
  const session = await SessionModel.findOne({ refreshTokenHash: hash });
  if (!session) {
    const reused = await SessionModel.findOne({ previousTokenHashes: hash });
    if (reused && !reused.revokedAt) {
      reused.revokedAt = new Date();
      reused.revokedReason = 'refresh_token_reuse';
      await reused.save();
      await recordAudit({ tenantId: reused.tenantId, actor: { userId: reused.userId, role: null, type: 'user' }, action: 'auth.refresh_reuse_detected', outcome: 'failure', entityType: 'Session', entityId: reused._id, requestId: client.requestId, ip: client.ip });
    }
    throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }
  if (session.revokedAt || session.expiresAt < new Date()) throw AppError.unauthorized('Session expired', 'SESSION_REVOKED');

  const user = await UserModel.findOne({ _id: session.userId }).setOptions({ skipTenantGuard: true }).lean();
  if (!user || !user.isActive) {
    session.revokedAt = new Date();
    session.revokedReason = 'user_inactive';
    await session.save();
    throw AppError.unauthorized('Account is inactive', 'ACCOUNT_INACTIVE');
  }

  const newToken = randomToken(48);
  // Atomic compare-and-swap so two concurrent refreshes cannot both succeed.
  const updated = await SessionModel.findOneAndUpdate(
    { _id: session._id, refreshTokenHash: hash, revokedAt: null },
    {
      $set: { refreshTokenHash: sha256Hex(newToken), lastUsedAt: new Date() },
      $push: { previousTokenHashes: { $each: [hash], $slice: -20 } },
    },
    { new: true },
  );
  if (!updated) throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  return { accessToken: signAccessToken(user, session._id), expiresIn: env().ACCESS_TOKEN_TTL_SECONDS, refreshToken: newToken, refreshExpiresAt: updated.expiresAt };
}

export async function logout(ctx: RequestContext): Promise<void> {
  await SessionModel.updateOne({ _id: ctx.sessionId }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } });
  await recordAudit({ ...fromContext(ctx), action: 'auth.logout', entityType: 'Session', entityId: ctx.sessionId });
}

export async function revokeAllSessions(userId: Types.ObjectId, reason: string, exceptSessionId?: string): Promise<number> {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  const res = await SessionModel.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
  return res.modifiedCount;
}

export async function listSessions(ctx: RequestContext) {
  const sessions = await SessionModel.find({ userId: ctx.userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .select('-refreshTokenHash -previousTokenHashes').sort({ lastUsedAt: -1 }).lean();
  return sessions.map((s) => ({ id: s._id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, current: s._id === ctx.sessionId }));
}

export async function revokeSession(ctx: RequestContext, sessionId: string): Promise<void> {
  const res = await SessionModel.updateOne({ _id: sessionId, userId: ctx.userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'user_revoked' } });
  if (res.matchedCount === 0) throw AppError.notFound('Session');
  await recordAudit({ ...fromContext(ctx), action: 'auth.session_revoked', entityType: 'Session', entityId: sessionId });
}

export async function changePassword(ctx: RequestContext, current: string, next: string): Promise<void> {
  const user = await UserModel.findOne({ _id: ctx.userId }).select('+passwordHash').setOptions({ skipTenantGuard: true });
  if (!user || !(await verifyPassword(user.passwordHash, current))) throw AppError.businessRule('Current password is incorrect', 'WRONG_PASSWORD');
  user.passwordHash = await hashPassword(next);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(ctx.userId, 'password_changed', ctx.sessionId);
  await recordAudit({ ...fromContext(ctx), action: 'auth.password_changed', entityType: 'User', entityId: ctx.userId });
}

/** Always succeeds from the caller's view, so it cannot be used to enumerate accounts. */
export async function requestPasswordReset(email: string, resetUrlBase: string, client: ClientInfo): Promise<void> {
  const user = await UserModel.findOne({ email: email.toLowerCase().trim(), isActive: true }).setOptions({ skipTenantGuard: true }).lean();
  if (!user) return;
  const token = randomToken(32);
  await PasswordResetModel.create({ userId: user._id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000) });
  await getMailer().send({
    to: user.email,
    subject: 'Password reset / إعادة تعيين كلمة المرور',
    text: `Use this link within ${RESET_TOKEN_MINUTES} minutes to reset your password: ${resetUrlBase}?token=${token}`,
  });
  await recordAudit({ tenantId: user.tenantId, actor: { userId: user._id, role: user.role, type: 'user' }, action: 'auth.password_reset_requested', entityType: 'User', entityId: user._id, requestId: client.requestId, ip: client.ip });
}

export async function resetPassword(token: string, newPassword: string, client: ClientInfo): Promise<void> {
  const reset = await PasswordResetModel.findOneAndUpdate(
    { tokenHash: sha256Hex(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  if (!reset) throw AppError.businessRule('Reset link is invalid or has expired', 'INVALID_RESET_TOKEN');
  const passwordHash = await hashPassword(newPassword);
  const user = await UserModel.findOneAndUpdate(
    { _id: reset.userId },
    { $set: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } },
  ).setOptions({ skipTenantGuard: true });
  if (!user) throw AppError.notFound('User');
  await revokeAllSessions(user._id, 'password_reset');
  await recordAudit({ tenantId: user.tenantId, actor: { userId: user._id, role: user.role, type: 'user' }, action: 'auth.password_reset', entityType: 'User', entityId: user._id, requestId: client.requestId, ip: client.ip });
}

export async function beginMfaEnrollment(ctx: RequestContext): Promise<{ secret: string; otpauthUrl: string }> {
  const user = await UserModel.findOne({ _id: ctx.userId }).setOptions({ skipTenantGuard: true });
  if (!user) throw AppError.notFound('User');
  if (user.mfa?.enabled) throw AppError.conflict('Multi-factor authentication is already enabled', 'MFA_ALREADY_ENABLED');
  const secret = authenticator.generateSecret();
  await UserModel.updateOne({ _id: ctx.userId }, { $set: { 'mfa.secretEnc': encryptSecret(secret), 'mfa.enabled': false } }).setOptions({ skipTenantGuard: true });
  return { secret, otpauthUrl: authenticator.keyuri(user.email, 'E-Receipt Platform', secret) };
}

export async function confirmMfaEnrollment(ctx: RequestContext, code: string): Promise<void> {
  const user = await UserModel.findOne({ _id: ctx.userId }).select('+mfa.secretEnc').setOptions({ skipTenantGuard: true });
  if (!user?.mfa?.secretEnc) throw AppError.businessRule('Start enrollment first', 'MFA_NOT_STARTED');
  if (!authenticator.check(code, decryptSecret(user.mfa.secretEnc))) throw AppError.businessRule('Invalid verification code', 'MFA_INVALID');
  await UserModel.updateOne({ _id: ctx.userId }, { $set: { 'mfa.enabled': true } }).setOptions({ skipTenantGuard: true });
  await recordAudit({ ...fromContext(ctx), action: 'auth.mfa_enabled', entityType: 'User', entityId: ctx.userId });
}

/** Turning MFA off requires the current password and a valid code. */
export async function disableMfa(ctx: RequestContext, password: string, code: string): Promise<void> {
  const user = await UserModel.findOne({ _id: ctx.userId }).select('+passwordHash +mfa.secretEnc').setOptions({ skipTenantGuard: true });
  if (!user?.mfa?.enabled || !user.mfa.secretEnc) throw AppError.businessRule('Multi-factor authentication is not enabled', 'MFA_NOT_ENABLED');
  if (!(await verifyPassword(user.passwordHash, password))) throw AppError.businessRule('Current password is incorrect', 'WRONG_PASSWORD');
  if (!authenticator.check(code, decryptSecret(user.mfa.secretEnc))) throw AppError.businessRule('Invalid verification code', 'MFA_INVALID');
  await UserModel.updateOne({ _id: ctx.userId }, { $set: { 'mfa.enabled': false, 'mfa.secretEnc': null } }).setOptions({ skipTenantGuard: true });
  await recordAudit({ ...fromContext(ctx), action: 'auth.mfa_disabled', entityType: 'User', entityId: ctx.userId });
}

export async function me(ctx: RequestContext) {
  const user = await UserModel.findOne({ _id: ctx.userId }).setOptions({ skipTenantGuard: true });
  if (!user) throw AppError.notFound('User');
  return { user: user.toJSON(), permissions: [...permissionsFor(user.role as Role)], branchAccess: ctx.branchIds === 'ALL' ? 'ALL' : ctx.branchIds.map(String) };
}
