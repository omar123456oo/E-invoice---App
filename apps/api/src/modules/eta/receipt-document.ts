import { sha256Hex } from '../../common/crypto/crypto.js';
import type { DiscountResult, LineResult, ReceiptTotals } from '../tax/calculation.js';
import type { PaymentMethod } from '../tenants/tenant.model.js';
import { num, serialize, toEtaJson, type EtaObject } from './serializer.js';

/**
 * Builds ETA receipt / return receipt documents, version 1.2
 * (sdk.invoicing.eta.gov.eg/documents/receipt-v1-2/ and return-receipt-v1-2/,
 * reviewed 2026-10-18). Property order follows the order of the official
 * field tables; optional fields without a value are omitted.
 */
export const RECEIPT_TYPE_VERSION = '1.2';

/** Mapping of internal payment methods to ETA payment method codes (codes/payment-methods). */
export const ETA_PAYMENT_CODES: Record<PaymentMethod, string> = {
  CASH: 'C',
  CARD: 'V',
  VOUCHER: 'VO',
  GIFT_CARD: 'GC',
  POINTS: 'P',
  // No dedicated ETA code exists for these at review date; "O" (Others) is used. See compliance matrix.
  BANK_TRANSFER: 'O',
  WALLET: 'O',
  OTHER: 'O',
};

export interface SellerSnapshot {
  rin: string;
  companyTradeName: string;
  branchCode: string;
  branchAddress: {
    country: string;
    governate: string;
    regionCity: string;
    street: string;
    buildingNumber: string;
    postalCode?: string | null;
    floor?: string | null;
    room?: string | null;
    landmark?: string | null;
    additionalInformation?: string | null;
  };
  deviceSerialNumber: string;
  activityCode: string;
}

export interface BuyerSnapshot {
  type: 'P' | 'B' | 'F';
  id?: string | null;
  name?: string | null;
  mobileNumber?: string | null;
  paymentNumber?: string | null;
}

export interface ItemSnapshot extends LineResult {
  internalCode: string;
  description: string;
  itemType: 'GS1' | 'EGS';
  itemCode: string;
  unitType: string;
}

export interface ReceiptSnapshot {
  kind: 'SALE' | 'RETURN';
  dateTimeIssued: Date;
  receiptNumber: string;
  previousUUID: string;
  referenceUUID?: string | null;
  referenceOldUUID?: string | null;
  currency: string;
  exchangeRate?: string | null;
  seller: SellerSnapshot;
  buyer: BuyerSnapshot;
  items: ItemSnapshot[];
  totals: ReceiptTotals;
  paymentMethodCode: string;
}

/** ETA expects UTC with second precision, e.g. 2022-02-03T00:00:00Z. */
export function etaDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

const opt = (v: string | null | undefined): string | undefined => (v === null || v === undefined || v === '' ? undefined : v);

function discount(d: DiscountResult): EtaObject {
  return { amount: num(d.amount), description: d.description, rate: d.rate ? num(d.rate) : undefined };
}

export function buildReceiptDocument(s: ReceiptSnapshot, uuid = ''): EtaObject {
  const header: EtaObject = {
    dateTimeIssued: etaDateTime(s.dateTimeIssued),
    receiptNumber: s.receiptNumber,
    uuid,
    previousUUID: s.previousUUID,
    referenceUUID: s.kind === 'RETURN' ? (s.referenceUUID ?? '') : undefined,
    referenceOldUUID: opt(s.referenceOldUUID),
    currency: s.currency,
    exchangeRate: s.currency !== 'EGP' && s.exchangeRate ? num(s.exchangeRate) : undefined,
  };
  const a = s.seller.branchAddress;
  return {
    header,
    documentType: { receiptType: s.kind === 'SALE' ? 's' : 'r', typeVersion: RECEIPT_TYPE_VERSION },
    seller: {
      rin: s.seller.rin,
      companyTradeName: s.seller.companyTradeName,
      branchCode: s.seller.branchCode,
      branchAddress: {
        country: a.country,
        governate: a.governate,
        regionCity: a.regionCity,
        street: a.street,
        buildingNumber: a.buildingNumber,
        postalCode: opt(a.postalCode),
        floor: opt(a.floor),
        room: opt(a.room),
        landmark: opt(a.landmark),
        additionalInformation: opt(a.additionalInformation),
      },
      deviceSerialNumber: s.seller.deviceSerialNumber,
      activityCode: s.seller.activityCode,
    },
    buyer: {
      type: s.buyer.type,
      id: opt(s.buyer.id),
      name: opt(s.buyer.name),
      mobileNumber: opt(s.buyer.mobileNumber),
      paymentNumber: opt(s.buyer.paymentNumber),
    },
    itemData: s.items.map((it) => ({
      internalCode: it.internalCode,
      description: it.description,
      itemType: it.itemType,
      itemCode: it.itemCode,
      unitType: it.unitType,
      quantity: num(it.quantity),
      unitPrice: num(it.unitPrice),
      netSale: num(it.netSale),
      totalSale: num(it.totalSale),
      total: num(it.total),
      commercialDiscountData: it.commercialDiscount ? [discount(it.commercialDiscount)] : undefined,
      itemDiscountData: it.itemDiscount ? [discount(it.itemDiscount)] : undefined,
      taxableItems: it.taxableItems.map((t) => ({ taxType: t.taxType, amount: num(t.amount), subType: t.subType, rate: num(t.rate) })),
    })),
    totalSales: num(s.totals.totalSales),
    totalCommercialDiscount: num(s.totals.totalCommercialDiscount),
    totalItemsDiscount: num(s.totals.totalItemsDiscount),
    extraReceiptDiscountData: s.totals.extraReceiptDiscount ? [discount(s.totals.extraReceiptDiscount)] : undefined,
    netAmount: num(s.totals.netAmount),
    // Reserved for future use; ETA accepts only zero (receipt v1.2).
    feesAmount: num('0'),
    totalAmount: num(s.totals.totalAmount),
    taxTotals: s.totals.taxTotals.map((t) => ({ taxType: t.taxType, amount: num(t.amount) })),
    paymentMethod: s.paymentMethodCode,
    adjustment: num('0'),
  };
}

/**
 * ETA Receipt Issuance FAQ, "Steps to generate UUID": build the document with
 * an empty uuid (including previousUUID and, for returns, referenceUUID),
 * serialize, SHA-256, hex-encode the 32 bytes as 64 characters.
 * Hex letter case is not specified by ETA; lowercase is used (see compliance matrix).
 */
export function computeReceiptUuid(s: ReceiptSnapshot): string {
  return sha256Hex(serialize(buildReceiptDocument(s, '')));
}

export interface IssuedDocument {
  uuid: string;
  /** Exact JSON text of the document as it will be submitted. */
  json: string;
  /** Canonical serialization the uuid was computed from (kept for audit/reproduction). */
  serialized: string;
}

export function issueDocument(s: ReceiptSnapshot): IssuedDocument {
  const serialized = serialize(buildReceiptDocument(s, ''));
  const uuid = sha256Hex(serialized);
  return { uuid, serialized, json: toEtaJson(buildReceiptDocument(s, uuid)) };
}
