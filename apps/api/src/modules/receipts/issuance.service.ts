import type { ClientSession, Types } from 'mongoose';
import { encryptSecret } from '../../common/crypto/crypto.js';
import { AppError } from '../../common/errors/app-error.js';
import { toDecimal128 } from '../../common/money/decimal.js';
import { issueDocument, RECEIPT_TYPE_VERSION, type BuyerSnapshot, type ItemSnapshot, type ReceiptSnapshot, type SellerSnapshot } from '../eta/receipt-document.js';
import { PosDeviceModel } from '../pos/pos-device.model.js';
import type { ReceiptTotals } from '../tax/calculation.js';
import type { EtaStatus } from './eta-status.js';
import { ReceiptModel, type ReceiptDoc } from './receipt.model.js';

export interface IssueLine extends ItemSnapshot {
  productId: Types.ObjectId;
  taxRuleRefs: Array<{ code: string; version: number }>;
  originalLineNo?: number;
}

export interface IssueInput {
  tenantId: Types.ObjectId;
  branchId: Types.ObjectId;
  deviceId: Types.ObjectId;
  transactionId: Types.ObjectId;
  returnId?: Types.ObjectId | null;
  cashierId: Types.ObjectId;
  kind: 'SALE' | 'RETURN';
  seller: Omit<SellerSnapshot, 'deviceSerialNumber'>;
  buyer: BuyerSnapshot;
  buyerDisplay: { name: string | null; idLast4: string | null; mobileNumber: string | null; customerId: Types.ObjectId | null };
  lines: IssueLine[];
  totals: ReceiptTotals;
  calcPolicyVersion: string;
  currency: string;
  paymentMethodCode: string;
  referenceUUID?: string | null;
  originalReceiptId?: Types.ObjectId | null;
  initialEtaStatus: Extract<EtaStatus, 'NOT_SUBMITTED' | 'QUEUED'>;
}

/** Truncated to whole seconds: ETA dateTimeIssued has second precision. */
export const issueClock = { now: (): Date => new Date(Math.floor(Date.now() / 1000) * 1000) };

/**
 * Issues a receipt on a device inside the caller's transaction. Advances the
 * device chain (seq, previousUUID) with compare-and-swap; any concurrent
 * issuer on the same device causes a write conflict and the driver retries
 * the whole transaction, so the chain can never fork.
 */
export async function issueOnDevice(input: IssueInput, session: ClientSession): Promise<ReceiptDoc> {
  const device = await PosDeviceModel.findOne({ _id: input.deviceId, tenantId: input.tenantId }).session(session).lean();
  if (!device) throw AppError.notFound('POS device');
  if (device.status !== 'ACTIVE') throw AppError.businessRule('POS device is not active', 'DEVICE_INACTIVE');

  const seq = (device.chain?.seq ?? 0) + 1;
  const previousUUID = device.chain?.lastUuid ?? '';
  const receiptNumber = `${device.code}-${String(seq).padStart(8, '0')}`;
  let dateTimeIssued = issueClock.now();
  if (device.chain?.lastIssuedAt && dateTimeIssued < device.chain.lastIssuedAt) dateTimeIssued = device.chain.lastIssuedAt;

  const snapshot: ReceiptSnapshot = {
    kind: input.kind,
    dateTimeIssued,
    receiptNumber,
    previousUUID,
    referenceUUID: input.referenceUUID ?? null,
    currency: input.currency,
    seller: { ...input.seller, deviceSerialNumber: device.serialNumber },
    buyer: input.buyer,
    items: input.lines,
    totals: input.totals,
    paymentMethodCode: input.paymentMethodCode,
  };
  const issued = issueDocument(snapshot);

  const cas = await PosDeviceModel.updateOne(
    { _id: device._id, tenantId: input.tenantId, 'chain.seq': device.chain?.seq ?? 0 },
    { $set: { 'chain.seq': seq, 'chain.lastUuid': issued.uuid, 'chain.lastIssuedAt': dateTimeIssued } },
    { session },
  );
  if (cas.modifiedCount !== 1) throw AppError.conflict('Receipt chain advanced concurrently; retry', 'CHAIN_CONFLICT');

  const [receipt] = await ReceiptModel.create(
    [
      {
        tenantId: input.tenantId,
        branchId: input.branchId,
        deviceId: input.deviceId,
        transactionId: input.transactionId,
        returnId: input.returnId ?? null,
        kind: input.kind,
        receiptNumber,
        chainSeq: seq,
        uuid: issued.uuid,
        previousUUID,
        referenceUUID: input.referenceUUID ?? null,
        originalReceiptId: input.originalReceiptId ?? null,
        dateTimeIssued,
        currency: input.currency,
        paymentMethodCode: input.paymentMethodCode,
        cashierId: input.cashierId,
        seller: snapshot.seller,
        buyer: { type: input.buyer.type, ...input.buyerDisplay },
        lines: input.lines.map((l) => ({
          lineNo: l.lineNo,
          productId: l.productId,
          internalCode: l.internalCode,
          description: l.description,
          itemType: l.itemType,
          itemCode: l.itemCode,
          unitType: l.unitType,
          quantity: toDecimal128(l.quantity),
          unitPrice: toDecimal128(l.unitPrice),
          totalSale: toDecimal128(l.totalSale),
          commercialDiscount: l.commercialDiscount ? { ...l.commercialDiscount, amount: toDecimal128(l.commercialDiscount.amount) } : null,
          netSale: toDecimal128(l.netSale),
          taxableItems: l.taxableItems.map((t, i) => ({
            ...t,
            amount: toDecimal128(t.amount),
            ruleCode: l.taxRuleRefs[i]?.code ?? 'UNKNOWN',
            ruleVersion: l.taxRuleRefs[i]?.version ?? 0,
          })),
          itemDiscount: l.itemDiscount ? { ...l.itemDiscount, amount: toDecimal128(l.itemDiscount.amount) } : null,
          total: toDecimal128(l.total),
          originalLineNo: l.originalLineNo ?? null,
        })),
        totals: {
          ...input.totals,
          extraReceiptDiscount: input.totals.extraReceiptDiscount
            ? { ...input.totals.extraReceiptDiscount, amount: toDecimal128(input.totals.extraReceiptDiscount.amount) }
            : null,
          taxTotals: input.totals.taxTotals.map((t) => ({ taxType: t.taxType, amount: toDecimal128(t.amount) })),
        },
        calcPolicyVersion: input.calcPolicyVersion,
        etaDocumentVersion: RECEIPT_TYPE_VERSION,
        etaDocumentEnc: encryptSecret(issued.json),
        eta: {
          status: input.initialEtaStatus,
          statusChangedAt: dateTimeIssued,
          history: [{ at: dateTimeIssued, from: null, to: input.initialEtaStatus, reason: 'issued' }],
        },
      },
    ],
    { session },
  );
  return receipt!;
}
