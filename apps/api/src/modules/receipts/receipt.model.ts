import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { baseSchemaOptions, branchIdField, decimalField, tenantIdField, tenantScoped, toJsonTransform } from '../../common/db/schema-helpers.js';
import { ETA_STATUSES } from './eta-status.js';

const DiscountSnapshot = new Schema({ rate: { type: String, default: null }, amount: decimalField(true), description: String }, { _id: false });

const TaxSnapshot = new Schema(
  {
    taxType: { type: String, required: true },
    subType: { type: String, required: true },
    rate: { type: String, required: true },
    amount: decimalField(true),
    ruleCode: { type: String, required: true },
    ruleVersion: { type: Number, required: true },
  },
  { _id: false },
);

const ReceiptLineSchema = new Schema(
  {
    lineNo: { type: Number, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    internalCode: { type: String, required: true },
    description: { type: String, required: true },
    itemType: { type: String, required: true },
    itemCode: { type: String, required: true },
    unitType: { type: String, required: true },
    quantity: decimalField(true),
    unitPrice: decimalField(true),
    totalSale: decimalField(true),
    commercialDiscount: { type: DiscountSnapshot, default: null },
    netSale: decimalField(true),
    taxableItems: { type: [TaxSnapshot], default: [] },
    itemDiscount: { type: DiscountSnapshot, default: null },
    total: decimalField(true),
    // For sale receipts: quantity already returned. For return receipts: the original line number.
    returnedQuantity: { ...decimalField(true), default: () => '0' },
    originalLineNo: { type: Number, default: null },
  },
  { _id: false },
);

const BuyerSchema = new Schema(
  {
    type: { type: String, enum: ['P', 'B', 'F'], required: true },
    name: { type: String, default: null },
    idLast4: { type: String, default: null },
    mobileNumber: { type: String, default: null },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  },
  { _id: false },
);

const TotalsSchema = new Schema(
  {
    totalSales: decimalField(true),
    totalCommercialDiscount: decimalField(true),
    totalItemsDiscount: decimalField(true),
    netAmount: decimalField(true),
    extraReceiptDiscount: { type: DiscountSnapshot, default: null },
    taxTotals: [{ _id: false, taxType: String, amount: decimalField(true) }],
    totalAmount: decimalField(true),
  },
  { _id: false },
);

const EtaStateSchema = new Schema(
  {
    status: { type: String, enum: ETA_STATUSES, required: true },
    statusChangedAt: { type: Date, required: true },
    submissionId: { type: Schema.Types.ObjectId, ref: 'EtaSubmission', default: null },
    submissionUuid: { type: String, default: null },
    longId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    lastError: {
      code: { type: String, default: null },
      message: { type: String, default: null },
      details: { type: Schema.Types.Mixed, default: null },
    },
    supersededBy: { type: Schema.Types.ObjectId, ref: 'Receipt', default: null },
    // Set once an alert was raised that the 24-hour submission window is running out.
    windowAlertedAt: { type: Date, default: null },
    history: {
      type: [{ _id: false, at: Date, from: String, to: String, reason: String }],
      default: [],
    },
  },
  { _id: false },
);

/**
 * Issued receipt (sale or return). Everything under `issued*`, `lines`,
 * `totals`, `seller`, `buyer` and the encrypted ETA document is an immutable
 * snapshot written once at issuance; later processing only changes `eta`
 * and the return counters. The application never edits issued data.
 */
const ReceiptSchema = new Schema(
  {
    tenantId: tenantIdField,
    branchId: branchIdField,
    deviceId: { type: Schema.Types.ObjectId, ref: 'PosDevice', required: true },
    transactionId: { type: Schema.Types.ObjectId, ref: 'SalesTransaction', required: true },
    returnId: { type: Schema.Types.ObjectId, ref: 'Return', default: null },
    kind: { type: String, enum: ['SALE', 'RETURN'], required: true },
    receiptNumber: { type: String, required: true, maxlength: 50 },
    chainSeq: { type: Number, required: true },
    uuid: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    previousUUID: { type: String, default: '' },
    referenceUUID: { type: String, default: null },
    referenceOldUUID: { type: String, default: null },
    // 0 for an original receipt; n for the n-th correction (same chain position, new UUID, referenceOldUUID set).
    correctionSeq: { type: Number, default: 0 },
    correctsReceiptId: { type: Schema.Types.ObjectId, ref: 'Receipt', default: null },
    correctionReason: { type: String, default: null, maxlength: 500 },
    originalReceiptId: { type: Schema.Types.ObjectId, ref: 'Receipt', default: null },
    dateTimeIssued: { type: Date, required: true },
    currency: { type: String, required: true },
    paymentMethodCode: { type: String, required: true },
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seller: {
      rin: String, companyTradeName: String, branchCode: String, deviceSerialNumber: String, activityCode: String,
      branchAddress: { type: Schema.Types.Mixed },
    },
    // Display snapshot: identity numbers are masked here; the full value exists only inside the encrypted ETA document.
    buyer: { type: BuyerSchema, required: true },
    lines: { type: [ReceiptLineSchema], required: true, validate: [(v: unknown[]) => v.length >= 1 && v.length <= 300, '1 to 300 lines'] },
    totals: { type: TotalsSchema, required: true },
    calcPolicyVersion: { type: String, required: true },
    etaDocumentVersion: { type: String, required: true },
    etaDocumentEnc: { type: String, required: true, select: false },
    returnStatus: { type: String, enum: ['NONE', 'PARTIAL', 'FULL'], default: 'NONE' },
    printCount: { type: Number, default: 0 },
    eta: { type: EtaStateSchema, required: true },
  },
  {
    ...baseSchemaOptions,
    toJSON: {
      ...baseSchemaOptions.toJSON,
      // The encrypted ETA document is never part of an API response, even on a freshly created document.
      transform: (doc: unknown, ret: Record<string, unknown>) => {
        delete ret.etaDocumentEnc;
        return toJsonTransform(doc, ret);
      },
    },
  },
);

ReceiptSchema.index({ tenantId: 1, uuid: 1 }, { unique: true });
ReceiptSchema.index({ tenantId: 1, branchId: 1, receiptNumber: 1, correctionSeq: 1 }, { unique: true });
ReceiptSchema.index({ tenantId: 1, deviceId: 1, chainSeq: 1, correctionSeq: 1 }, { unique: true });
ReceiptSchema.index({ tenantId: 1, branchId: 1, dateTimeIssued: -1 });
ReceiptSchema.index({ tenantId: 1, 'eta.status': 1, deviceId: 1, chainSeq: 1 });
ReceiptSchema.index({ tenantId: 1, 'eta.submissionUuid': 1 }, { partialFilterExpression: { 'eta.submissionUuid': { $type: 'string' } } });
ReceiptSchema.index({ tenantId: 1, originalReceiptId: 1 });
tenantScoped(ReceiptSchema);

const IMMUTABLE_PATHS = ['correctionSeq', 'referenceOldUUID', 'uuid', 'previousUUID', 'referenceUUID', 'receiptNumber', 'chainSeq', 'dateTimeIssued', 'lines', 'totals', 'seller', 'buyer', 'etaDocumentEnc', 'kind', 'currency'];

/** Guards against code paths that try to rewrite issued data through update operators. */
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate'] as const) {
  ReceiptSchema.pre(op, function () {
    const update = (this.getUpdate() ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const touched = Object.keys({ ...(update.$set ?? {}), ...(update.$unset ?? {}) });
    const bad = touched.filter((k) => IMMUTABLE_PATHS.some((p) => k === p || (k.startsWith(`${p}.`) && !/^lines\.\d+\.returnedQuantity$/.test(k))));
    if (bad.length) throw new Error(`Issued receipt data is immutable: ${bad.join(', ')}`);
  });
}
for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  ReceiptSchema.pre(op, () => {
    throw new Error('Receipts cannot be deleted');
  });
}

export type Receipt = InferSchemaType<typeof ReceiptSchema>;
export type ReceiptDoc = HydratedDocument<Receipt>;
export const ReceiptModel = model('Receipt', ReceiptSchema, 'receipts');
