import { decryptSecret, encryptSecret, sha256Hex } from '../../common/crypto/crypto.js';
import { AppError } from '../../common/errors/app-error.js';
import { withTransaction } from '../../common/db/mongo.js';
import { assertBranchAccess, requireTenant, type RequestContext } from '../../common/security/context.js';
import { enqueueSafely } from '../../jobs/queue.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { normaliseIdentity, validateIdentity } from '../customers/customer.service.js';
import { parseEtaJson, serialize, toEtaJson, type EtaObject, type EtaValue } from '../eta/serializer.js';
import { ProductModel } from '../products/product.model.js';
import { ReturnModel } from '../returns/return.model.js';
import { SalesTransactionModel } from '../sales/sales-transaction.model.js';
import { assertTransition, type EtaStatus } from './eta-status.js';
import { ReceiptModel } from './receipt.model.js';

/**
 * ETA Receipt Issuance FAQ (reviewed 2026-10-18): a corrected receipt gets a new
 * UUID, keeps the previousUUID of the invalid receipt, carries ReferenceOldUUID
 * = UUID of the invalid receipt, and amendments with a reference are allowed
 * within 96 hours. Later receipts of the device keep their content.
 *
 * Only identification data may be corrected (item codes, unit types,
 * descriptions, buyer details). Quantities, prices, discounts, taxes and totals
 * are the sale itself and cannot be changed through a correction.
 */
export const CORRECTION_WINDOW_HOURS = 96;
const CORRECTABLE: ReadonlySet<EtaStatus> = new Set(['REJECTED', 'INVALID', 'FAILED']);

export interface CorrectionInput {
  reason: string;
  useCurrentProductCodes?: boolean;
  lines?: Array<{ lineNo: number; itemType?: 'GS1' | 'EGS'; itemCode?: string; unitType?: string; description?: string }>;
  buyer?: { type: 'P' | 'B' | 'F'; name?: string; identity?: string; mobileNumber?: string };
}

const str = (v: EtaValue | undefined): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String((v as { literal?: string }).literal ?? v));

export async function correctReceipt(ctx: RequestContext, receiptId: string, input: CorrectionInput, now = new Date()) {
  const tenantId = requireTenant(ctx);
  const original = await ReceiptModel.findOne({ tenantId, _id: receiptId }).select('+etaDocumentEnc').lean();
  if (!original) throw AppError.notFound('Receipt');
  assertBranchAccess(ctx, original.branchId);
  const status = original.eta.status as EtaStatus;
  if (!CORRECTABLE.has(status)) throw AppError.businessRule(`Only rejected, invalid or failed receipts can be corrected (status ${status})`, 'NOT_CORRECTABLE');
  const ageHours = (now.getTime() - original.dateTimeIssued.getTime()) / 3_600_000;
  if (ageHours > CORRECTION_WINDOW_HOURS) {
    throw AppError.businessRule(`Corrections are allowed within ${CORRECTION_WINDOW_HOURS} hours of issuance`, 'CORRECTION_WINDOW_EXPIRED');
  }
  if (original.returnStatus !== 'NONE') throw AppError.businessRule('A receipt with returns cannot be corrected', 'HAS_RETURNS');

  const doc = parseEtaJson(decryptSecret(original.etaDocumentEnc as string)) as EtaObject;
  const contentOf = (d: EtaObject) => serialize({ ...d, header: null });
  const before = contentOf(doc);
  const items = doc.itemData as EtaObject[];
  const lineFix = new Map((input.lines ?? []).map((l) => [l.lineNo, l]));
  for (const no of lineFix.keys()) if (!original.lines.some((l) => l.lineNo === no)) throw AppError.validation([{ path: 'body.lines', message: `Unknown line ${no}` }]);

  const products = input.useCurrentProductCodes
    ? new Map((await ProductModel.find({ tenantId, _id: { $in: original.lines.map((l) => l.productId) } }).lean()).map((p) => [String(p._id), p]))
    : new Map();
  const newLines = original.lines.map((l, idx) => {
    const p = products.get(String(l.productId));
    const fix = lineFix.get(l.lineNo);
    const next = {
      itemType: fix?.itemType ?? (p?.etaItemType as 'GS1' | 'EGS' | undefined) ?? l.itemType,
      itemCode: fix?.itemCode ?? p?.etaItemCode ?? l.itemCode,
      unitType: fix?.unitType ?? p?.unitType ?? l.unitType,
      description: fix?.description ?? l.description,
    };
    const item = items[idx]!;
    item.itemType = next.itemType;
    item.itemCode = next.itemCode;
    item.unitType = next.unitType;
    item.description = next.description;
    return { ...l, ...next };
  });

  let buyerDisplay = original.buyer;
  if (input.buyer) {
    const b = input.buyer;
    if (b.identity) validateIdentity(b.type, b.identity);
    const id = b.identity ? normaliseIdentity(b.identity) : undefined;
    if ((b.type !== 'P' || id) && (!id || !b.name)) throw AppError.validation([{ path: 'body.buyer', message: 'Identity number and name are required' }]);
    const old = doc.buyer as EtaObject;
    doc.buyer = { type: b.type, id: id ?? old.id, name: b.name ?? old.name, mobileNumber: b.mobileNumber ?? old.mobileNumber, paymentNumber: old.paymentNumber };
    buyerDisplay = { ...original.buyer, type: b.type, name: b.name ?? original.buyer.name ?? null, idLast4: id ? id.slice(-4) : original.buyer.idLast4 ?? null, mobileNumber: b.mobileNumber ?? original.buyer.mobileNumber ?? null };
  }

  if (contentOf(doc) === before) throw AppError.businessRule('The correction does not change anything', 'NOTHING_TO_CORRECT');

  // Rebuild the header in the documented field order with the new reference.
  const h = doc.header as EtaObject;
  const header = (uuid: string): EtaObject => ({
    dateTimeIssued: h.dateTimeIssued, receiptNumber: h.receiptNumber, uuid, previousUUID: h.previousUUID,
    referenceUUID: h.referenceUUID, referenceOldUUID: original.uuid, currency: h.currency, exchangeRate: h.exchangeRate,
    sOrderNameCode: h.sOrderNameCode, orderdeliveryMode: h.orderdeliveryMode, grossWeight: h.grossWeight, netWeight: h.netWeight,
  });
  doc.header = header('');
  const uuid = sha256Hex(serialize(doc));
  doc.header = header(uuid);
  if (str(h.previousUUID) !== original.previousUUID) throw new Error('Stored document does not match receipt snapshot');

  const result = await withTransaction(async (session) => {
    const { _id: _old, eta: _eta, createdAt: _c, updatedAt: _u, ...rest } = original as typeof original & { createdAt?: Date; updatedAt?: Date };
    const [created] = await ReceiptModel.create([{
      ...rest,
      uuid,
      referenceOldUUID: original.uuid,
      correctionSeq: (original.correctionSeq ?? 0) + 1,
      correctsReceiptId: original._id,
      correctionReason: input.reason,
      lines: newLines,
      buyer: buyerDisplay,
      etaDocumentEnc: encryptSecret(toEtaJson(doc)),
      printCount: 0,
      eta: { status: 'QUEUED', statusChangedAt: now, history: [{ at: now, from: null, to: 'QUEUED', reason: `correction of ${original.uuid}` }] },
    }], { session });
    assertTransition(status, 'SUPERSEDED');
    const upd = await ReceiptModel.updateOne(
      { tenantId, _id: original._id, 'eta.status': status },
      {
        $set: { 'eta.status': 'SUPERSEDED', 'eta.statusChangedAt': now, 'eta.supersededBy': created!._id },
        $push: { 'eta.history': { $each: [{ at: now, from: status, to: 'SUPERSEDED', reason: `corrected by ${uuid}: ${input.reason}`.slice(0, 300) }], $slice: -50 } },
      },
      { session },
    );
    if (upd.modifiedCount !== 1) throw AppError.conflict('Receipt changed concurrently', 'CONCURRENT_UPDATE');
    if (original.kind === 'SALE') await SalesTransactionModel.updateOne({ tenantId, _id: original.transactionId }, { $set: { receiptId: created!._id } }, { session });
    else if (original.returnId) await ReturnModel.updateOne({ tenantId, _id: original.returnId }, { $set: { returnReceiptId: created!._id } }, { session });
    await recordAudit({ ...fromContext(ctx), branchId: original.branchId, action: 'receipt.corrected', entityType: 'Receipt', entityId: created!._id, summary: input.reason, changes: { oldUuid: original.uuid, newUuid: uuid, lines: input.lines ?? null, useCurrentProductCodes: Boolean(input.useCurrentProductCodes), buyerChanged: Boolean(input.buyer) } }, session);
    return created!;
  });
  await enqueueSafely('eta.submit-device', { tenantId: String(tenantId), deviceId: String(original.deviceId) }, { jobId: `submit:${original.deviceId}` });
  return result;
}

