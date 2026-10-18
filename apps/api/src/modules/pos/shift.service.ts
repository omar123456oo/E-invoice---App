import { Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error.js';
import { dec, DECIMAL_STRING_RE, sum } from '../../common/money/decimal.js';
import { assertBranchAccess, hasPermission, requireTenant, type RequestContext } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { PaymentModel } from '../payments/payment.model.js';
import { CashierShiftModel } from './cashier-shift.model.js';
import { PosDeviceModel } from './pos-device.model.js';

export async function openShift(ctx: RequestContext, deviceId: string, openingCash: string) {
  const tenantId = requireTenant(ctx);
  if (!DECIMAL_STRING_RE.test(openingCash) || dec(openingCash).lt(0)) throw AppError.validation([{ path: 'body.openingCash', message: 'Invalid amount' }]);
  const device = await PosDeviceModel.findOne({ _id: deviceId, tenantId }).lean();
  if (!device) throw AppError.notFound('POS device');
  assertBranchAccess(ctx, device.branchId);
  if (device.status !== 'ACTIVE') throw AppError.businessRule('POS device is not active', 'DEVICE_INACTIVE');
  try {
    const shift = await CashierShiftModel.create({ tenantId, branchId: device.branchId, deviceId: device._id, cashierId: ctx.userId, openedAt: new Date(), openingCash });
    await recordAudit({ ...fromContext(ctx), branchId: device.branchId, action: 'shift.opened', entityType: 'CashierShift', entityId: shift._id, changes: { openingCash } });
    return shift.toJSON();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw AppError.conflict('An open shift already exists for this device or cashier', 'SHIFT_ALREADY_OPEN');
    throw err;
  }
}

export async function expectedCash(tenantId: Types.ObjectId, shiftId: Types.ObjectId, openingCash: string): Promise<{ cashIn: string; cashOut: string; expected: string }> {
  const rows = await PaymentModel.find({ tenantId, shiftId, method: 'CASH' }, { direction: 1, amount: 1 }).lean();
  const cashIn = sum(rows.filter((r) => r.direction === 'IN').map((r) => r.amount));
  const cashOut = sum(rows.filter((r) => r.direction === 'OUT').map((r) => r.amount));
  return { cashIn: cashIn.toFixed(2), cashOut: cashOut.toFixed(2), expected: dec(openingCash).plus(cashIn).minus(cashOut).toFixed(2) };
}

export async function closeShift(ctx: RequestContext, shiftId: string, countedCash: string, notes?: string) {
  const tenantId = requireTenant(ctx);
  if (!DECIMAL_STRING_RE.test(countedCash) || dec(countedCash).lt(0)) throw AppError.validation([{ path: 'body.countedCash', message: 'Invalid amount' }]);
  const shift = await CashierShiftModel.findOne({ _id: shiftId, tenantId });
  if (!shift) throw AppError.notFound('Shift');
  assertBranchAccess(ctx, shift.branchId);
  if (shift.status !== 'OPEN') throw AppError.businessRule('Shift is already closed', 'SHIFT_CLOSED');
  if (!shift.cashierId.equals(ctx.userId) && !hasPermission(ctx, 'pos:shifts:manage')) throw AppError.forbidden('Only the shift cashier or a manager can close this shift');

  const { expected, cashIn, cashOut } = await expectedCash(tenantId, shift._id, shift.openingCash.toString());
  const variance = dec(countedCash).minus(expected).toFixed(2);
  const updated = await CashierShiftModel.findOneAndUpdate(
    { _id: shift._id, tenantId, status: 'OPEN' },
    { $set: { status: 'CLOSED', closedAt: new Date(), countedCash, expectedCash: expected, variance, closingNotes: notes ?? null, closedBy: ctx.userId } },
    { new: true },
  );
  if (!updated) throw AppError.conflict('Shift was closed concurrently', 'SHIFT_CLOSED');
  await recordAudit({ ...fromContext(ctx), branchId: shift.branchId, action: 'shift.closed', entityType: 'CashierShift', entityId: shift._id, changes: { countedCash, expected, variance, cashIn, cashOut } });
  return { ...updated.toJSON(), cashIn, cashOut };
}

export async function currentShift(ctx: RequestContext) {
  const shift = await CashierShiftModel.findOne({ tenantId: requireTenant(ctx), cashierId: ctx.userId, status: 'OPEN' });
  return shift ? shift.toJSON() : null;
}
