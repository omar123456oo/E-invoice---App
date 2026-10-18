import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

/**
 * Optional customer profile. Anonymous consumer sales need no profile.
 * Identity numbers (national ID / RIN / foreign ID) are collected only when a
 * transaction requires them, are encrypted at rest and are searchable only by
 * a keyed hash. API responses expose a masked value.
 */
const CustomerSchema = new Schema(
  {
    tenantId: tenantIdField,
    // ETA buyer.type: P natural person, B business in Egypt, F foreigner.
    buyerType: { type: String, enum: ['P', 'B', 'F'], required: true },
    name: { type: String, trim: true, maxlength: 100, default: null },
    identityEnc: { type: String, default: null, select: false },
    identityHash: { type: String, default: null, select: false },
    identityLast4: { type: String, default: null, maxlength: 4 },
    mobileNumber: { type: String, trim: true, maxlength: 30, default: null },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
    marketingConsent: { type: Boolean, default: false },
    notes: { type: String, maxlength: 500, default: null },
    lastPurchaseAt: { type: Date, default: null },
    anonymizedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
CustomerSchema.index({ tenantId: 1, identityHash: 1 }, { unique: true, partialFilterExpression: { identityHash: { $type: 'string' } } });
CustomerSchema.index({ tenantId: 1, mobileNumber: 1 });
CustomerSchema.index({ tenantId: 1, name: 1 });
tenantScoped(CustomerSchema);

export type Customer = InferSchemaType<typeof CustomerSchema>;
export const CustomerModel = model('Customer', CustomerSchema, 'customers');
