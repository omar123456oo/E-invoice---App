import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, branchIdField, decimalField, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';
import { PAYMENT_METHODS } from '../tenants/tenant.model.js';

/**
 * Money movement record. Sales payments (direction IN) and refunds (OUT) are
 * stored here so cash reconciliation reads one collection. Card payments are
 * never marked as captured by this system: an external terminal approval is
 * recorded as EXTERNALLY_AUTHORIZED with its authorization reference.
 * Card numbers and CVVs are never stored.
 */
const PaymentSchema = new Schema(
  {
    tenantId: tenantIdField,
    branchId: branchIdField,
    shiftId: { type: Schema.Types.ObjectId, ref: 'CashierShift', required: true },
    transactionId: { type: Schema.Types.ObjectId, ref: 'SalesTransaction', required: true },
    receiptId: { type: Schema.Types.ObjectId, ref: 'Receipt', required: true },
    returnId: { type: Schema.Types.ObjectId, ref: 'Return', default: null },
    direction: { type: String, enum: ['IN', 'OUT'], required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: decimalField(true),
    tendered: decimalField(false),
    change: decimalField(false),
    status: { type: String, enum: ['CAPTURED', 'EXTERNALLY_AUTHORIZED', 'PENDING_CONFIRMATION'], required: true },
    reference: { type: String, maxlength: 40, default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recordedAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
PaymentSchema.index({ tenantId: 1, shiftId: 1, method: 1 });
PaymentSchema.index({ tenantId: 1, transactionId: 1 });
PaymentSchema.index({ tenantId: 1, branchId: 1, recordedAt: -1 });
tenantScoped(PaymentSchema);

export type Payment = InferSchemaType<typeof PaymentSchema>;
export const PaymentModel = model('Payment', PaymentSchema, 'payments');
