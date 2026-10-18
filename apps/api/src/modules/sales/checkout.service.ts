import { Types } from 'mongoose';
import { sha256Hex } from '../../common/crypto/crypto.js';
import { AppError } from '../../common/errors/app-error.js';
import { withTransaction } from '../../common/db/mongo.js';
import { dec } from '../../common/money/decimal.js';
import { assertBranchAccess, hasPermission, requireTenant, type RequestContext } from '../../common/security/context.js';
import { enqueueSafely } from '../../jobs/queue.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { BranchModel } from '../branches/branch.model.js';
import { CustomerModel } from '../customers/customer.model.js';
import { revealIdentity, validateIdentity, normaliseIdentity } from '../customers/customer.service.js';
import type { BuyerSnapshot } from '../eta/receipt-document.js';
import { PaymentModel } from '../payments/payment.model.js';
import { primaryEtaPaymentCode, resolvePayments, type PaymentInput } from '../payments/payment-rules.js';
import { CashierShiftModel } from '../pos/cashier-shift.model.js';
import { PosDeviceModel } from '../pos/pos-device.model.js';
import { ProductModel } from '../products/product.model.js';
import { issueClock, issueOnDevice, type IssueLine } from '../receipts/issuance.service.js';
import { ReceiptModel } from '../receipts/receipt.model.js';
import { receiptView } from '../receipts/receipt-view.js';
import { calculateReceipt, type CalculationResult, type DiscountInput, type LineInput } from '../tax/calculation.js';
import { resolveTaxRules } from '../tax/tax.service.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { SalesTransactionModel } from './sales-transaction.model.js';

export interface CartItem {
  productId: string;
  quantity: string;
  discount?: DiscountInput;
}

export interface BuyerInput {
  type: 'P' | 'B' | 'F';
  name?: string;
  identity?: string;
  mobileNumber?: string;
}

export interface CheckoutInput {
  deviceId: string;
  items: CartItem[];
  extraDiscount?: DiscountInput;
  customerId?: string;
  buyer?: BuyerInput;
  payments: PaymentInput[];
}

interface PricedCart {
  calc: CalculationResult;
  lines: IssueLine[];
}

/** Prices a cart from catalogue data and tax rules in force at `at`. Client prices and totals are never trusted. */
async function priceCart(ctx: RequestContext, tenantId: Types.ObjectId, items: CartItem[], extraDiscount: DiscountInput | undefined, at: Date, maxDiscountPercent: string): Promise<PricedCart> {
  if (items.length === 0) throw AppError.validation([{ path: 'body.items', message: 'Cart is empty', code: 'EMPTY_RECEIPT' }]);
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await ProductModel.find({ tenantId, _id: { $in: ids } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const problems = items.flatMap((i, idx) => {
    const p = byId.get(i.productId);
    if (!p) return [{ path: `body.items.${idx}.productId`, message: 'Unknown product' }];
    if (!p.isActive) return [{ path: `body.items.${idx}.productId`, message: `${p.nameAr} is inactive` }];
    if (p.etaCodeStatus === 'REJECTED') return [{ path: `body.items.${idx}.productId`, message: `${p.nameAr} has a rejected ETA item code` }];
    return [];
  });
  if (problems.length) throw AppError.validation(problems, 'Cart contains invalid products');

  const rules = await resolveTaxRules(tenantId, products.flatMap((p) => p.taxCodes), at);
  const lineInputs: LineInput[] = items.map((i, idx) => {
    const p = byId.get(i.productId)!;
    return { lineNo: idx + 1, quantity: i.quantity, unitPrice: p.unitPrice.toString(), commercialDiscount: i.discount, taxes: p.taxCodes.map((c) => rules.get(c)!) };
  });
  const calc = calculateReceipt(lineInputs, extraDiscount);

  // Discounts above the cashier limit need an explicit override permission.
  if (!hasPermission(ctx, 'sales:discount:override')) {
    const limit = dec(maxDiscountPercent);
    const over = calc.lines.some((l) => l.commercialDiscount && dec(l.commercialDiscount.amount).gt(dec(l.totalSale).times(limit).div(100)));
    const extraOver = calc.totals.extraReceiptDiscount && dec(calc.totals.extraReceiptDiscount.amount).gt(dec(calc.totals.totalSales).times(limit).div(100));
    if (over || extraOver) throw AppError.forbidden(`Discounts above ${limit.toFixed()}% require manager approval`, 'DISCOUNT_LIMIT_EXCEEDED');
  }

  const lines: IssueLine[] = calc.lines.map((l, idx) => {
    const p = byId.get(items[idx]!.productId)!;
    return {
      ...l,
      productId: p._id,
      internalCode: p.internalCode,
      description: p.description,
      itemType: p.etaItemType as 'GS1' | 'EGS',
      itemCode: p.etaItemCode,
      unitType: p.unitType,
      taxRuleRefs: p.taxCodes.map((c) => ({ code: c, version: rules.get(c)!.version })),
    };
  });
  return { calc, lines };
}

/**
 * ETA receipt v1.2 buyer rules: B requires id (RIN) and name; P requires
 * national ID and name when totalAmount ≥ the configured threshold; F id is any
 * foreign identification. Otherwise no identity is collected.
 */
async function resolveBuyer(tenantId: Types.ObjectId, input: CheckoutInput, totalAmount: string, threshold: string) {
  let buyer: BuyerSnapshot = { type: 'P' };
  let display = { name: null as string | null, idLast4: null as string | null, mobileNumber: null as string | null, customerId: null as Types.ObjectId | null };

  if (input.customerId) {
    const c = await CustomerModel.findOne({ _id: input.customerId, tenantId, anonymizedAt: null }).lean();
    if (!c) throw AppError.notFound('Customer');
    const id = await revealIdentity(tenantId, c._id);
    buyer = { type: c.buyerType as 'P' | 'B' | 'F', id, name: c.name, mobileNumber: c.mobileNumber };
    display = { name: c.name ?? null, idLast4: c.identityLast4 ?? null, mobileNumber: c.mobileNumber ?? null, customerId: c._id };
  } else if (input.buyer) {
    if (input.buyer.identity) validateIdentity(input.buyer.type, input.buyer.identity);
    const id = input.buyer.identity ? normaliseIdentity(input.buyer.identity) : null;
    buyer = { type: input.buyer.type, id, name: input.buyer.name ?? null, mobileNumber: input.buyer.mobileNumber ?? null };
    display = { name: buyer.name ?? null, idLast4: id ? id.slice(-4) : null, mobileNumber: buyer.mobileNumber ?? null, customerId: null };
  }

  const needsIdentity = buyer.type === 'B' || buyer.type === 'F' || dec(totalAmount).gte(dec(threshold));
  if (needsIdentity && (!buyer.id || !buyer.name)) {
    throw AppError.businessRule(
      buyer.type === 'P'
        ? `Receipts of ${dec(threshold).toFixed(2)} or more require the buyer's national ID and name`
        : 'Business and foreign buyers require an identity number and a name',
      'BUYER_IDENTITY_REQUIRED',
    );
  }
  return { buyer, display };
}

export async function quote(ctx: RequestContext, items: CartItem[], extraDiscount?: DiscountInput): Promise<CalculationResult> {
  const tenantId = requireTenant(ctx);
  const tenant = await TenantModel.findById(tenantId).lean();
  if (!tenant) throw AppError.notFound('Company');
  return (await priceCart(ctx, tenantId, items, extraDiscount, issueClock.now(), tenant.settings!.maxCashierDiscountPercent.toString())).calc;
}

function requestHash(input: CheckoutInput): string {
  return sha256Hex(JSON.stringify(input));
}

export async function checkout(ctx: RequestContext, input: CheckoutInput, idempotencyKey: string) {
  const tenantId = requireTenant(ctx);
  const hash = requestHash(input);

  // Idempotent replay: same key returns the original result; a different payload with the same key is refused.
  const existing = await SalesTransactionModel.findOne({ tenantId, idempotencyKey }).lean();
  if (existing) {
    if (existing.requestHash !== hash || !existing.cashierId.equals(ctx.userId)) {
      throw AppError.conflict('Idempotency key was already used for a different sale', 'IDEMPOTENCY_KEY_REUSED');
    }
    const receipt = await ReceiptModel.findOne({ tenantId, _id: existing.receiptId });
    return { replayed: true, transaction: existing, receipt: receiptView(receipt!) };
  }

  const [tenant, device] = await Promise.all([
    TenantModel.findById(tenantId).lean(),
    PosDeviceModel.findOne({ _id: input.deviceId, tenantId }).lean(),
  ]);
  if (!tenant || tenant.status !== 'ACTIVE') throw AppError.forbidden('Company is not active', 'TENANT_INACTIVE');
  if (!device) throw AppError.notFound('POS device');
  assertBranchAccess(ctx, device.branchId);
  const [branch, shift] = await Promise.all([
    BranchModel.findOne({ _id: device.branchId, tenantId }).lean(),
    CashierShiftModel.findOne({ tenantId, deviceId: device._id, cashierId: ctx.userId, status: 'OPEN' }).lean(),
  ]);
  if (!branch?.isActive) throw AppError.businessRule('Branch is not active', 'BRANCH_INACTIVE');
  if (!shift) throw AppError.businessRule('Open a shift on this device before selling', 'NO_OPEN_SHIFT');

  const settings = tenant.settings!;
  const at = issueClock.now();
  const { calc, lines } = await priceCart(ctx, tenantId, input.items, input.extraDiscount, at, settings.maxCashierDiscountPercent.toString());
  const { buyer, display } = await resolveBuyer(tenantId, input, calc.totals.totalAmount, settings.buyerIdentityThreshold.toString());
  const payments = resolvePayments(calc.totals.totalAmount, input.payments, {
    enabledMethods: settings.enabledPaymentMethods as never,
    requireCardAuthorizationRef: settings.requireCardAuthorizationRef ?? true,
  });
  const etaQueued = Boolean(tenant.eta?.submissionEnabled);

  const result = await withTransaction(async (session) => {
    const transactionId = new Types.ObjectId();
    const receipt = await issueOnDevice(
      {
        tenantId, branchId: branch._id, deviceId: device._id, transactionId, cashierId: ctx.userId, kind: 'SALE',
        seller: {
          rin: tenant.taxRegistrationNumber, companyTradeName: tenant.tradeName, branchCode: branch.etaBranchCode,
          branchAddress: branch.address as never, activityCode: branch.activityCode ?? tenant.activityCode,
        },
        buyer, buyerDisplay: display, lines, totals: calc.totals, calcPolicyVersion: calc.policyVersion,
        currency: settings.currency ?? 'EGP', paymentMethodCode: primaryEtaPaymentCode(payments),
        initialEtaStatus: etaQueued ? 'QUEUED' : 'NOT_SUBMITTED',
      },
      session,
    );
    const [transaction] = await SalesTransactionModel.create(
      [{
        _id: transactionId, tenantId, branchId: branch._id, deviceId: device._id, shiftId: shift._id, cashierId: ctx.userId,
        customerId: display.customerId, idempotencyKey, requestHash: hash, receiptId: receipt._id,
        totalAmount: calc.totals.totalAmount, amountPaid: calc.totals.totalAmount, completedAt: receipt.dateTimeIssued,
      }],
      { session },
    );
    await PaymentModel.create(
      payments.map((p) => ({
        tenantId, branchId: branch._id, shiftId: shift._id, transactionId, receiptId: receipt._id, direction: 'IN',
        method: p.method, amount: p.amount, tendered: p.tendered, change: p.change, status: p.status, reference: p.reference,
        recordedBy: ctx.userId, recordedAt: receipt.dateTimeIssued,
      })),
      { session, ordered: true },
    );
    if (display.customerId) await CustomerModel.updateOne({ _id: display.customerId, tenantId }, { $set: { lastPurchaseAt: receipt.dateTimeIssued } }, { session });
    await recordAudit({
      ...fromContext(ctx), branchId: branch._id, action: 'sale.completed', entityType: 'Receipt', entityId: receipt._id,
      summary: `${receipt.receiptNumber} total ${calc.totals.totalAmount}`, changes: { uuid: receipt.uuid, totalAmount: calc.totals.totalAmount },
    }, session);
    return { transaction: transaction!.toJSON(), receipt: receiptView(receipt), change: payments.find((p) => p.change)?.change ?? '0.00' };
  });

  if (etaQueued) await enqueueSafely('eta.submit-device', { tenantId: String(tenantId), deviceId: String(device._id) }, { jobId: `submit:${device._id}` });
  return { replayed: false, ...result };
}
