import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, branchIdField, decimalField, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

/** Cashier shift on one device, with opening float and closing cash count. */
const CashierShiftSchema = new Schema(
  {
    tenantId: tenantIdField,
    branchId: branchIdField,
    deviceId: { type: Schema.Types.ObjectId, ref: 'PosDevice', required: true },
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    openedAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    openingCash: decimalField(true),
    countedCash: decimalField(false),
    expectedCash: decimalField(false),
    variance: decimalField(false),
    closingNotes: { type: String, maxlength: 500, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  baseSchemaOptions,
);
// One open shift per device and per cashier.
CashierShiftSchema.index({ tenantId: 1, deviceId: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
CashierShiftSchema.index({ tenantId: 1, cashierId: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
CashierShiftSchema.index({ tenantId: 1, branchId: 1, openedAt: -1 });
tenantScoped(CashierShiftSchema);

export type CashierShift = InferSchemaType<typeof CashierShiftSchema>;
export const CashierShiftModel = model('CashierShift', CashierShiftSchema, 'cashierShifts');
