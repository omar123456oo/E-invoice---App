import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions } from '../../common/db/schema-helpers.js';

/**
 * Append-only, hash-chained audit trail. Each event stores the hash of the
 * previous event in the same chain (one chain per tenant plus a platform
 * chain), so deletion or modification of any event is detectable by
 * re-computing the chain. The application never updates or deletes events.
 */
const AuditEventSchema = new Schema(
  {
    chainKey: { type: String, required: true },
    seq: { type: Number, required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    at: { type: Date, required: true },
    actor: {
      userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      role: { type: String, default: null },
      type: { type: String, enum: ['user', 'system', 'anonymous'], required: true },
    },
    action: { type: String, required: true, maxlength: 100 },
    outcome: { type: String, enum: ['success', 'failure'], default: 'success' },
    entityType: { type: String, default: null, maxlength: 60 },
    entityId: { type: String, default: null, maxlength: 64 },
    summary: { type: String, default: null, maxlength: 500 },
    changes: { type: Schema.Types.Mixed, default: null },
    requestId: { type: String, default: null },
    ip: { type: String, default: null },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  // minimize: false keeps empty objects (e.g. a no-op diff `{}`); dropping them would break the stored hash.
  { ...baseSchemaOptions, timestamps: false, minimize: false },
);

AuditEventSchema.index({ chainKey: 1, seq: 1 }, { unique: true });
AuditEventSchema.index({ tenantId: 1, at: -1 });
AuditEventSchema.index({ tenantId: 1, entityType: 1, entityId: 1, at: -1 });
AuditEventSchema.index({ tenantId: 1, action: 1, at: -1 });

const forbidMutation = function () {
  throw new Error('Audit events are append-only');
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne'] as const) {
  AuditEventSchema.pre(op, forbidMutation);
}

export type AuditEvent = InferSchemaType<typeof AuditEventSchema>;
export const AuditEventModel = model('AuditEvent', AuditEventSchema, 'auditEvents');
