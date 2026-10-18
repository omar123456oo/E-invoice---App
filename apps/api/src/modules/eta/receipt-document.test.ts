import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../common/crypto/crypto.js';
import { calculateReceipt } from '../tax/calculation.js';
import { buildReceiptDocument, computeReceiptUuid, etaDateTime, issueDocument, type ReceiptSnapshot } from './receipt-document.js';
import { parseEtaJson, serialize } from './serializer.js';

function snapshot(overrides: Partial<ReceiptSnapshot> = {}): ReceiptSnapshot {
  const calc = calculateReceipt([
    { lineNo: 1, quantity: '2', unitPrice: '50.00', commercialDiscount: { rate: '10', description: 'Promo' }, taxes: [{ code: 'VAT', version: 1, etaTaxType: 'T1', etaSubType: 'V009', treatment: 'PERCENTAGE', rate: '14' }] },
  ]);
  return {
    kind: 'SALE',
    dateTimeIssued: new Date('2026-10-18T08:30:15.123Z'),
    receiptNumber: 'B1-P1-000001',
    previousUUID: '',
    currency: 'EGP',
    seller: {
      rin: '123456789', companyTradeName: 'Test Co', branchCode: '0', deviceSerialNumber: 'SN-1', activityCode: '4711',
      branchAddress: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: 'Street 1', buildingNumber: '1', floor: null },
    },
    buyer: { type: 'P' },
    items: calc.lines.map((l) => ({ ...l, internalCode: 'SKU1', description: 'Item', itemType: 'EGS', itemCode: 'EG-123456789-1', unitType: 'EA' })),
    totals: calc.totals,
    paymentMethodCode: 'C',
    ...overrides,
  };
}

describe('receipt document v1.2', () => {
  it('formats dateTimeIssued in UTC to the second', () => {
    expect(etaDateTime(new Date('2026-10-18T08:30:15.999Z'))).toBe('2026-10-18T08:30:15Z');
  });

  it('builds the documented structure with root-level totals', () => {
    const doc = buildReceiptDocument(snapshot());
    expect(Object.keys(doc)).toEqual([
      'header', 'documentType', 'seller', 'buyer', 'itemData', 'totalSales', 'totalCommercialDiscount', 'totalItemsDiscount',
      'extraReceiptDiscountData', 'netAmount', 'feesAmount', 'totalAmount', 'taxTotals', 'paymentMethod', 'adjustment',
    ]);
    expect(doc.documentType).toEqual({ receiptType: 's', typeVersion: '1.2' });
  });

  it('computes the uuid as SHA-256 of the serialization with an empty uuid', () => {
    const s = snapshot();
    const issued = issueDocument(s);
    expect(issued.uuid).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.uuid).toBe(sha256Hex(issued.serialized));
    expect(issued.uuid).toBe(computeReceiptUuid(s));
    // The submitted JSON, with uuid blanked, serializes to exactly what was hashed.
    const parsed = parseEtaJson(issued.json) as { header: Record<string, unknown> };
    parsed.header.uuid = '';
    expect(serialize(parsed as never)).toBe(issued.serialized);
  });

  it('omits empty optional fields and exchange rate for EGP', () => {
    const json = issueDocument(snapshot()).json;
    expect(json).not.toContain('"floor"');
    expect(json).not.toContain('exchangeRate');
    expect(json).not.toContain('"id"');
    expect(json).toContain('"amount":10.00');
  });

  it('changes the uuid when the previous uuid in the chain changes', () => {
    expect(computeReceiptUuid(snapshot())).not.toBe(computeReceiptUuid(snapshot({ previousUUID: 'a'.repeat(64) })));
  });

  it('builds return receipts with type r and the original reference', () => {
    const ref = 'b'.repeat(64);
    const doc = buildReceiptDocument(snapshot({ kind: 'RETURN', referenceUUID: ref }));
    expect(doc.documentType).toEqual({ receiptType: 'r', typeVersion: '1.2' });
    expect((doc.header as Record<string, unknown>).referenceUUID).toBe(ref);
  });
});
