import type { Types } from 'mongoose';
import { decryptSecret } from '../../common/crypto/crypto.js';
import { AppError, type ErrorDetail } from '../../common/errors/app-error.js';
import { withTransaction } from '../../common/db/mongo.js';
import { dec, Decimal, sum } from '../../common/money/decimal.js';
import { assertBranchAccess, hasPermission, requireTenant, type RequestContext } from '../../common/security/context.js';
import { enqueueSafely } from '../../jobs/queue.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { BranchModel } from '../branches/branch.model.js';
import { ETA_PAYMENT_CODES, type BuyerSnapshot } from '../eta/receipt-document.js';
import { parseEtaJson } from '../eta/serializer.js';
import { PaymentModel } from '../payments/payment.model.js';
import { looksLikeCardNumber } from '../payments/payment-rules.js';
import { CashierShiftModel } from '../pos/cashier-shift.model.js';
import { expectedCash } from '../pos/shift.service.js';
import { PosDeviceModel } from '../pos/pos-device.model.js';
import { issueOnDevice, type IssueLine } from '../receipts/issuance.service.js';
import { ReceiptModel } from '../receipts/receipt.model.js';
import { receiptView } from '../receipts/receipt-view.js';
import { SalesTransactionModel } from '../sales/sales-transaction.model.js';
import { buildTotals, cumulativeShare, POLICY_VERSION, type DiscountResult, type LineResult } from '../tax/calculation.js';
import { TenantModel, type PaymentMethod } from '../tenants/tenant.model.js';
import { ReturnModel } from './return.model.js';

export interface ReturnRequestInput {
  originalReceiptId: string;
  lines: Array<{ lineNo: number; quantity: string }>;
  reason: string;
  refundMethod: PaymentMethod;
  refundReference?: string;
}

/** ETA statuses of the original sale that block a return receipt referencing it. */
const BLOCKING_ORIGINAL_STATUSES = new Set(['INVALID', 'REJECTED', 'CANCELLED', 'FAILED', 'SUPERSEDED']);

const s2 = (v: Decimal) => v.toFixed(2);
const str = (v: unknown) => String(v);

type OriginalReceipt = NonNullable<Awaited<ReturnType<typeof loadOriginal>>>;

async function loadOriginal(tenantId: Types.ObjectId, id: string | Types.ObjectId, session?: import('mongoose').ClientSession) {
  return ReceiptModel.findOne({ tenantId, _id: id, kind: 'SALE' }).session(session ?? null).lean();
}

/**
 * Return line amounts are derived from the original receipt snapshot — never
 * from current prices or tax rules — using cumulative proportional shares so
 * that returning all units reproduces the original amounts exactly.
 */
export function computeReturnLines(original: OriginalReceipt, request: Array<{ lineNo: number; quantity: string }>) {
  const errors: ErrorDetail[] = [];
  const seen = new Set<number>();
  const lines: IssueLine[] = [];
  for (const [i, req] of request.entries()) {
    const o = original.lines.find((l) => l.lineNo === req.lineNo);
    const path = `body.lines.${i}`;
    if (!o) {
      errors.push({ path, message: `Line ${req.lineNo} does not exist on the original receipt`, code: 'UNKNOWN_LINE' });
      continue;
    }
    if (seen.has(req.lineNo)) errors.push({ path, message: 'Line listed twice', code: 'DUPLICATE_LINE' });
    seen.add(req.lineNo);
    const q = dec(req.quantity);
    const origQty = str(o.quantity);
    const already = str(o.returnedQuantity ?? '0');
    const remaining = dec(origQty).minus(already);
    if (q.lte(0)) errors.push({ path: `${path}.quantity`, message: 'Quantity must be positive', code: 'INVALID_QUANTITY' });
    if (q.gt(remaining)) errors.push({ path: `${path}.quantity`, message: `Only ${remaining.toFixed()} left to return on line ${req.lineNo}`, code: 'EXCEEDS_RETURNABLE' });
    if (errors.length) continue;

    const share = (amount: unknown) => cumulativeShare(str(amount), origQty, already, req.quantity);
    const totalSale = share(o.totalSale);
    const cd = o.commercialDiscount ? share(o.commercialDiscount.amount) : null;
    const netSale = s2(dec(totalSale).minus(cd ?? '0'));
    const taxableItems = o.taxableItems.map((t) => ({ taxType: t.taxType, subType: t.subType, rate: t.rate, amount: share(t.amount) }));
    const id = o.itemDiscount ? share(o.itemDiscount.amount) : null;
    const total = s2(dec(netSale).plus(sum(taxableItems.map((t) => t.amount))).minus(id ?? '0'));
    const disc = (src: { rate?: string | null; description?: string | null } | null | undefined, amount: string | null): DiscountResult | null =>
      src && amount && !dec(amount).isZero() ? { rate: src.rate ?? null, amount, description: src.description ?? '' } : null;

    const line: LineResult = {
      lineNo: lines.length + 1,
      quantity: q.toFixed(),
      unitPrice: str(o.unitPrice),
      totalSale,
      commercialDiscount: disc(o.commercialDiscount, cd),
      netSale,
      taxableItems,
      itemDiscount: disc(o.itemDiscount, id),
      total,
    };
    lines.push({
      ...line,
      productId: o.productId,
      internalCode: o.internalCode,
      description: o.description,
      itemType: o.itemType as 'GS1' | 'EGS',
      itemCode: o.itemCode,
      unitType: o.unitType,
      taxRuleRefs: o.taxableItems.map((t) => ({ code: t.ruleCode, version: t.ruleVersion })),
      originalLineNo: o.lineNo,
    });
  }
  if (errors.length) throw AppError.validation(errors, 'Return is not valid');

  // Extra receipt discount is shared in proportion to the returned share of the original line totals.
  let extra: DiscountResult | null = null;
  const origExtra = original.totals.extraReceiptDiscount;
  if (origExtra && !dec(str(origExtra.amount)).isZero()) {
    const origLinesTotal = sum(original.lines.map((l) => str(l.total)));
    const returned = sum(lines.map((l) => l.total));
    const amount = s2(dec(str(origExtra.amount)).times(returned).div(origLinesTotal).toDecimalPlaces(2));
    if (!dec(amount).isZero()) extra = { rate: null, amount, description: origExtra.description ?? 'Discount' };
  }
  return { lines, totals: buildTotals(lines, extra) };
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export async function createReturn(ctx: RequestContext, input: ReturnRequestInput, idempotencyKey: string) {
  const tenantId = requireTenant(ctx);
  const existing = await ReturnModel.findOne({ tenantId, idempotencyKey });
  if (existing) return { replayed: true, return: existing.toJSON() };

  if (input.refundReference && looksLikeCardNumber(input.refundReference)) {
    throw AppError.validation([{ path: 'body.refundReference', message: 'Never enter a card number', code: 'CARD_NUMBER_REFUSED' }]);
  }
  const [tenant, original] = await Promise.all([TenantModel.findById(tenantId).lean(), loadOriginal(tenantId, input.originalReceiptId)]);
  if (!tenant) throw AppError.notFound('Company');
  if (!original) throw AppError.notFound('Original sale receipt');
  assertBranchAccess(ctx, original.branchId);
  if (BLOCKING_ORIGINAL_STATUSES.has(original.eta.status)) {
    throw AppError.businessRule(`The original receipt is ${original.eta.status} at ETA; it must be corrected before a return can reference it`, 'ORIGINAL_NOT_RETURNABLE');
  }
  const settings = tenant.settings!;
  const age = daysBetween(original.dateTimeIssued, new Date());
  if (age > (settings.returnWindowDays ?? 540)) {
    throw AppError.businessRule(`Returns are allowed within ${settings.returnWindowDays} days of the sale`, 'RETURN_WINDOW_EXPIRED');
  }
  if (!(settings.enabledPaymentMethods as string[]).includes(input.refundMethod)) {
    throw AppError.validation([{ path: 'body.refundMethod', message: 'Refund method is not enabled', code: 'METHOD_DISABLED' }]);
  }
  const { totals } = computeReturnLines(original, input.lines);

  const reasons: string[] = [];
  if (dec(totals.totalAmount).gt(dec(str(settings.returnApprovalAmount)))) reasons.push('AMOUNT_ABOVE_LIMIT');
  if (age > (settings.returnApprovalAfterDays ?? 30)) reasons.push('OLDER_THAN_LIMIT');
  const autoApproved = reasons.length === 0 || hasPermission(ctx, 'returns:approve');

  const ret = await ReturnModel.create({
    tenantId, branchId: original.branchId, originalReceiptId: original._id, originalTransactionId: original.transactionId,
    status: autoApproved ? 'APPROVED' : 'PENDING_APPROVAL', reason: input.reason,
    lines: input.lines, refundMethod: input.refundMethod, refundReference: input.refundReference ?? null,
    estimatedRefund: totals.totalAmount, requiresApprovalReasons: reasons, requestedBy: ctx.userId, idempotencyKey,
    ...(autoApproved && reasons.length ? { decidedBy: ctx.userId, decidedAt: new Date(), decisionNotes: 'Approved by requester with approval permission' } : {}),
  });
  await recordAudit({ ...fromContext(ctx), branchId: original.branchId, action: 'return.requested', entityType: 'Return', entityId: ret._id, changes: { originalReceipt: original.receiptNumber, lines: input.lines, estimatedRefund: totals.totalAmount, reasons } });
  return { replayed: false, return: ret.toJSON() };
}

export async function decideReturn(ctx: RequestContext, returnId: string, approve: boolean, notes?: string) {
  const tenantId = requireTenant(ctx);
  const ret = await ReturnModel.findOne({ _id: returnId, tenantId });
  if (!ret) throw AppError.notFound('Return');
  assertBranchAccess(ctx, ret.branchId);
  if (ret.status !== 'PENDING_APPROVAL') throw AppError.businessRule('Return is not awaiting approval', 'INVALID_RETURN_STATE');
  if (ret.requestedBy.equals(ctx.userId)) throw AppError.forbidden('Requesters cannot approve their own returns', 'SELF_APPROVAL');
  const updated = await ReturnModel.findOneAndUpdate(
    { _id: ret._id, tenantId, status: 'PENDING_APPROVAL' },
    { $set: { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: ctx.userId, decidedAt: new Date(), decisionNotes: notes ?? null } },
    { new: true },
  );
  await recordAudit({ ...fromContext(ctx), branchId: ret.branchId, action: approve ? 'return.approved' : 'return.rejected', entityType: 'Return', entityId: ret._id, summary: notes });
  return updated!.toJSON();
}

/** Recovers the full buyer block (including any identity number) from the original encrypted ETA document. */
function originalBuyer(etaDocumentEnc: string): BuyerSnapshot {
  const doc = parseEtaJson(decryptSecret(etaDocumentEnc)) as unknown as { buyer: BuyerSnapshot };
  return doc.buyer;
}

/**
 * Completes an approved return on the cashier's device: issues the return
 * receipt (receiptType r, referenceUUID = original UUID), records the refund
 * as an OUT payment in the open shift and updates returned quantities, all in
 * one transaction.
 */
export async function completeReturn(ctx: RequestContext, returnId: string, deviceId: string) {
  const tenantId = requireTenant(ctx);
  const [tenant, device] = await Promise.all([TenantModel.findById(tenantId).lean(), PosDeviceModel.findOne({ _id: deviceId, tenantId }).lean()]);
  if (!tenant) throw AppError.notFound('Company');
  if (!device) throw AppError.notFound('POS device');
  assertBranchAccess(ctx, device.branchId);
  const shift = await CashierShiftModel.findOne({ tenantId, deviceId: device._id, cashierId: ctx.userId, status: 'OPEN' }).lean();
  if (!shift) throw AppError.businessRule('Open a shift on this device before processing refunds', 'NO_OPEN_SHIFT');
  const branch = await BranchModel.findOne({ _id: device.branchId, tenantId }).lean();
  if (!branch) throw AppError.notFound('Branch');
  const etaQueued = Boolean(tenant.eta?.submissionEnabled);

  const result = await withTransaction(async (session) => {
    const ret = await ReturnModel.findOne({ _id: returnId, tenantId }).session(session);
    if (!ret) throw AppError.notFound('Return');
    if (ret.status !== 'APPROVED') throw AppError.businessRule(`Return is ${ret.status}`, 'INVALID_RETURN_STATE');
    if (!ret.branchId.equals(device.branchId)) throw AppError.businessRule('Process the return at the branch of the original sale', 'WRONG_BRANCH');

    const original = await ReceiptModel.findOne({ tenantId, _id: ret.originalReceiptId }).select('+etaDocumentEnc').session(session).lean();
    if (!original) throw AppError.notFound('Original sale receipt');
    if (BLOCKING_ORIGINAL_STATUSES.has(original.eta.status)) throw AppError.businessRule(`The original receipt is ${original.eta.status} at ETA`, 'ORIGINAL_NOT_RETURNABLE');
    const reqLines = ret.lines.map((l) => ({ lineNo: l.lineNo, quantity: l.quantity.toString() }));
    const { lines, totals } = computeReturnLines(original as OriginalReceipt, reqLines);
    if (ret.refundMethod === 'CASH') {
      const drawer = await expectedCash(tenantId, shift._id, shift.openingCash.toString());
      if (dec(drawer.expected).lt(totals.totalAmount)) {
        throw AppError.businessRule(`Not enough cash in the drawer for this refund (${drawer.expected} available)`, 'INSUFFICIENT_DRAWER_CASH');
      }
    }

    const receipt = await issueOnDevice({
      tenantId, branchId: branch._id, deviceId: device._id, transactionId: original.transactionId, returnId: ret._id, cashierId: ctx.userId,
      kind: 'RETURN', seller: { ...original.seller, branchAddress: original.seller!.branchAddress } as never,
      buyer: originalBuyer(original.etaDocumentEnc as string),
      buyerDisplay: { name: original.buyer.name ?? null, idLast4: original.buyer.idLast4 ?? null, mobileNumber: original.buyer.mobileNumber ?? null, customerId: original.buyer.customerId ?? null },
      lines, totals, calcPolicyVersion: POLICY_VERSION, currency: original.currency, paymentMethodCode: ETA_PAYMENT_CODES[ret.refundMethod as PaymentMethod],
      referenceUUID: original.uuid, originalReceiptId: original._id, initialEtaStatus: etaQueued ? 'QUEUED' : 'NOT_SUBMITTED',
    }, session);

    // Update returned quantities on the original; the transaction's snapshot read makes concurrent returns conflict and retry.
    const set: Record<string, unknown> = {};
    for (const l of reqLines) {
      const idx = original.lines.findIndex((o) => o.lineNo === l.lineNo);
      set[`lines.${idx}.returnedQuantity`] = dec(str(original.lines[idx]!.returnedQuantity ?? '0')).plus(l.quantity).toFixed();
    }
    const fully = original.lines.every((o, idx) => dec(String(set[`lines.${idx}.returnedQuantity`] ?? str(o.returnedQuantity ?? '0'))).gte(str(o.quantity)));
    set.returnStatus = fully ? 'FULL' : 'PARTIAL';
    await ReceiptModel.updateOne({ tenantId, _id: original._id }, { $set: set }, { session });

    await PaymentModel.create([{
      tenantId, branchId: branch._id, shiftId: shift._id, transactionId: original.transactionId, receiptId: receipt._id, returnId: ret._id,
      direction: 'OUT', method: ret.refundMethod, amount: totals.totalAmount,
      status: ret.refundMethod === 'CASH' ? 'CAPTURED' : ret.refundReference ? 'EXTERNALLY_AUTHORIZED' : 'PENDING_CONFIRMATION',
      reference: ret.refundReference ?? null, recordedBy: ctx.userId, recordedAt: receipt.dateTimeIssued,
    }], { session });

    const tx = await SalesTransactionModel.findOne({ tenantId, _id: original.transactionId }).session(session);
    if (tx) {
      tx.amountRefunded = dec(tx.amountRefunded.toString()).plus(totals.totalAmount).toFixed(2) as never;
      tx.status = fully ? 'FULLY_RETURNED' : 'PARTIALLY_RETURNED';
      await tx.save({ session });
    }
    ret.status = 'COMPLETED';
    ret.completedBy = ctx.userId;
    ret.completedAt = new Date();
    ret.returnReceiptId = receipt._id;
    await ret.save({ session });
    await recordAudit({ ...fromContext(ctx), branchId: branch._id, action: 'return.completed', entityType: 'Receipt', entityId: receipt._id, changes: { returnId: String(ret._id), referenceUUID: original.uuid, refund: totals.totalAmount, method: ret.refundMethod } }, session);
    return { return: ret.toJSON(), receipt: receiptView(receipt) };
  });

  if (etaQueued) await enqueueSafely('eta.submit-device', { tenantId: String(tenantId), deviceId: String(device._id) }, { jobId: `submit:${device._id}` });
  return result;
}

