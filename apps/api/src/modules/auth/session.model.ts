import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../common/db/schema-helpers.js';

/**
 * Login session. The refresh token is opaque, stored only as a SHA-256 hash
 * and rotated on every use. Presenting an already-rotated token revokes the
 * whole session (refresh-token reuse detection).
 */
const SessionSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    refreshTokenHash: { type: String, required: true },
    previousTokenHashes: { type: [String], default: [] },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 512 },
    lastUsedAt: { type: Date, default: () => new Date() },
  },
  { ...baseSchemaOptions, _id: false },
);

SessionSchema.index({ refreshTokenHash: 1 }, { unique: true });
SessionSchema.index({ previousTokenHashes: 1 });
// Expired sessions are removed automatically 30 days after expiry.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export type Session = InferSchemaType<typeof SessionSchema>;
export const SessionModel = model('Session', SessionSchema, 'sessions');

const PasswordResetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });
export const PasswordResetModel = model('PasswordReset', PasswordResetSchema, 'passwordResets');
