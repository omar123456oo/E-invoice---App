import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, branchIdField, decimalField, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';
import { PAYMENT_METHODS } from '../tenants/tenant.model.js';

/**
 * Return request. Kept separate from the return receipt (the ETA document)
 * and from the refund payment, because each has its own lifecycle:
 *   PENDING_APPROVAL -> APPROVED -> COMPLETED   (or REJECTED)
 *   COMPLETED means the return receipt was issued and the refund recorded;
 *   it says nothing about ETA acceptance, which is tracked on the receipt.
 */
const ReturnSchema = new Schema(
  {
    tenantId: tenantIdField,
    branchId: branchIdField,
    originalReceiptId: { type: Schema.Types.ObjectId, ref: 'Receipt', required: true },
    originalTransactionId: { type: Schema.Types.ObjectId, ref: 'SalesTransaction', required: true },
    status: { type: String, enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED'], required: true },
    reason: { type: String, required: true, maxlength: 500 },
    lines: [{ _id: false, lineNo: { type: Number, required: true }, quantity: decimalField(true) }],
    refundMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    refundReference: { type: String, maxlength: 40, default: null },
    estimatedRefund: decimalField(true),
    requiresApprovalReasons: { type: [String], default: [] },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNotes: { type: String, maxlength: 500, default: null },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
    returnReceiptId: { type: Schema.Types.ObjectId, ref: 'Receipt', default: null },
    idempotencyKey: { type: String, required: true, maxlength: 64 },
  },
  baseSchemaOptions,
);
ReturnSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
ReturnSchema.index({ tenantId: 1, originalReceiptId: 1 });
ReturnSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
tenantScoped(ReturnSchema);

export type Return = InferSchemaType<typeof ReturnSchema>;
export const ReturnModel = model('Return', ReturnSchema, 'returns');
