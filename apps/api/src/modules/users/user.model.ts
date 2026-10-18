import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { baseSchemaOptions, tenantScoped } from '../../common/db/schema-helpers.js';
import { ROLES } from '../../common/security/permissions.js';

const UserSchema = new Schema(
  {
    // Null only for platform administrators.
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    branchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
    isActive: { type: Boolean, default: true },
    locale: { type: String, enum: ['ar', 'en'], default: 'ar' },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    mfa: {
      enabled: { type: Boolean, default: false },
      secretEnc: { type: String, default: null, select: false },
    },
    passwordChangedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  {
    ...baseSchemaOptions,
    toJSON: {
      ...baseSchemaOptions.toJSON,
      transform: (doc: unknown, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        delete ret.failedLoginCount;
        delete ret.lockedUntil;
        if (ret.mfa && typeof ret.mfa === 'object') delete (ret.mfa as Record<string, unknown>).secretEnc;
        return (baseSchemaOptions.toJSON as { transform: (d: unknown, r: Record<string, unknown>) => unknown }).transform(doc, ret);
      },
    },
  },
);

// Email is the login identifier across the platform.
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, role: 1 });

tenantScoped(UserSchema);

export type User = InferSchemaType<typeof UserSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', UserSchema, 'users');
