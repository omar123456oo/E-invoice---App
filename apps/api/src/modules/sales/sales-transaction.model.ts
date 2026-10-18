import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, branchIdField, decimalField, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

/**
 * Internal sales transaction (the business event). Its status is independent
 * of the ETA processing status, which lives on the receipt.
 */
const SalesTransactionSchema = new Schema(
  {
    tenantId: tenantIdField,
    branchId: branchIdField,
    deviceId: { type: Schema.Types.ObjectId, ref: 'PosDevice', required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'CashierShift', required: true },
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    // Client-generated key that makes checkout safe to retry.
    idempotencyKey: { type: String, required: true, maxlength: 64 },
    requestHash: { type: String, required: true },
    status: { type: String, enum: ['COMPLETED', 'PARTIALLY_RETURNED', 'FULLY_RETURNED'], default: 'COMPLETED' },
    receiptId: { type: Schema.Types.ObjectId, ref: 'Receipt', required: true },
    totalAmount: decimalField(true),
    amountPaid: decimalField(true),
    amountRefunded: { ...decimalField(true), default: () => '0' },
    completedAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
SalesTransactionSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
SalesTransactionSchema.index({ tenantId: 1, branchId: 1, completedAt: -1 });
SalesTransactionSchema.index({ tenantId: 1, shiftId: 1 });
tenantScoped(SalesTransactionSchema);

export type SalesTransaction = InferSchemaType<typeof SalesTransactionSchema>;
export const SalesTransactionModel = model('SalesTransaction', SalesTransactionSchema, 'salesTransactions');
