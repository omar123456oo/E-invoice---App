import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error.js';
import { calculateReceipt, cumulativeShare, type TaxRuleSnapshot } from './calculation.js';

// Test fixture rates only. Real rates come from verified tax configuration versions.
const VAT14: TaxRuleSnapshot = { code: 'VAT_STD', version: 1, etaTaxType: 'T1', etaSubType: 'V009', treatment: 'PERCENTAGE', rate: '14' };
const EXEMPT: TaxRuleSnapshot = { code: 'VAT_EXEMPT', version: 1, etaTaxType: 'T1', etaSubType: 'V003', treatment: 'EXEMPT', rate: '0' };

describe('calculateReceipt', () => {
  it('computes a simple taxed line', () => {
    const r = calculateReceipt([{ lineNo: 1, quantity: '2', unitPrice: '50.00', taxes: [VAT14] }]);
    expect(r.lines[0]).toMatchObject({ totalSale: '100.00', netSale: '100.00', total: '114.00' });
    expect(r.lines[0]!.taxableItems).toEqual([{ taxType: 'T1', subType: 'V009', rate: '14', amount: '14.00' }]);
    expect(r.totals).toMatchObject({ totalSales: '100.00', netAmount: '100.00', totalAmount: '114.00', taxTotals: [{ taxType: 'T1', amount: '14.00' }] });
  });

  it('rounds half up at 2 decimals per line', () => {
    // 3 × 3.335 = 10.005 -> 10.01 ; tax 14% of 10.01 = 1.4014 -> 1.40
    const r = calculateReceipt([{ lineNo: 1, quantity: '3', unitPrice: '3.335', taxes: [VAT14] }]);
    expect(r.lines[0]).toMatchObject({ totalSale: '10.01', netSale: '10.01', total: '11.41' });
    expect(r.lines[0]!.taxableItems[0]!.amount).toBe('1.40');
  });

  it('applies commercial discount before tax (rate takes precedence over amount)', () => {
    const r = calculateReceipt([
      { lineNo: 1, quantity: '1', unitPrice: '200', commercialDiscount: { rate: '10', amount: '999', description: 'Promo' }, taxes: [VAT14] },
    ]);
    expect(r.lines[0]!.commercialDiscount).toEqual({ rate: '10', amount: '20.00', description: 'Promo' });
    expect(r.lines[0]).toMatchObject({ netSale: '180.00', total: '205.20' });
    expect(r.totals.totalCommercialDiscount).toBe('20.00');
  });

  it('applies item (non-taxable) discount after tax', () => {
    const r = calculateReceipt([
      { lineNo: 1, quantity: '1', unitPrice: '100', itemDiscount: { amount: '4', description: 'Coupon' }, taxes: [VAT14] },
    ]);
    expect(r.lines[0]).toMatchObject({ netSale: '100.00', total: '110.00' });
    expect(r.lines[0]!.taxableItems[0]!.amount).toBe('14.00');
    expect(r.totals.totalItemsDiscount).toBe('4.00');
  });

  it('mixes taxed and exempt lines and groups tax totals by type', () => {
    const r = calculateReceipt([
      { lineNo: 1, quantity: '1', unitPrice: '10', taxes: [VAT14] },
      { lineNo: 2, quantity: '4', unitPrice: '2.50', taxes: [EXEMPT] },
    ]);
    expect(r.lines[1]!.taxableItems[0]).toEqual({ taxType: 'T1', subType: 'V003', rate: '0', amount: '0.00' });
    expect(r.totals).toMatchObject({ totalSales: '20.00', netAmount: '20.00', totalAmount: '21.40', taxTotals: [{ taxType: 'T1', amount: '1.40' }] });
  });

  it('subtracts extra receipt discount from the sum of line totals', () => {
    const r = calculateReceipt([{ lineNo: 1, quantity: '1', unitPrice: '100', taxes: [VAT14] }], { amount: '14', description: 'Loyalty' });
    expect(r.totals.totalAmount).toBe('100.00');
    expect(r.totals.extraReceiptDiscount).toEqual({ rate: null, amount: '14.00', description: 'Loyalty' });
  });

  it('is deterministic for identical inputs', () => {
    const input = [{ lineNo: 1, quantity: '1.250', unitPrice: '19.99', taxes: [VAT14] }];
    expect(calculateReceipt(input)).toEqual(calculateReceipt(structuredClone(input)));
  });

  it.each([
    [{ quantity: '0', unitPrice: '1' }, 'INVALID_QUANTITY'],
    [{ quantity: '-1', unitPrice: '1' }, 'INVALID_QUANTITY'],
    [{ quantity: '1', unitPrice: '-1' }, 'INVALID_PRICE'],
  ])('rejects invalid line %o', (line, code) => {
    try {
      calculateReceipt([{ lineNo: 1, taxes: [VAT14], ...line }]);
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).details.map((d) => d.code)).toContain(code);
    }
  });

  it('rejects discounts larger than the base', () => {
    expect(() => calculateReceipt([{ lineNo: 1, quantity: '1', unitPrice: '10', commercialDiscount: { amount: '11', description: 'x' }, taxes: [VAT14] }])).toThrow(AppError);
  });

  it('rejects lines with no tax treatment, duplicate tax types and empty receipts', () => {
    expect(() => calculateReceipt([{ lineNo: 1, quantity: '1', unitPrice: '10', taxes: [] }])).toThrow(AppError);
    expect(() => calculateReceipt([{ lineNo: 1, quantity: '1', unitPrice: '10', taxes: [VAT14, EXEMPT] }])).toThrow(AppError);
    expect(() => calculateReceipt([])).toThrow(AppError);
  });

  it('refuses unverified tax treatments', () => {
    const tableTax: TaxRuleSnapshot = { code: 'TBL', version: 1, etaTaxType: 'T2', etaSubType: 'Tbl01', treatment: 'PERCENTAGE', rate: '8' };
    try {
      calculateReceipt([{ lineNo: 1, quantity: '1', unitPrice: '10', taxes: [tableTax] }]);
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('UNSUPPORTED_TAX_TREATMENT');
    }
  });

  it('limits a receipt to 300 lines', () => {
    const lines = Array.from({ length: 301 }, (_, i) => ({ lineNo: i + 1, quantity: '1', unitPrice: '1', taxes: [VAT14] }));
    expect(() => calculateReceipt(lines)).toThrow(AppError);
  });
});

describe('cumulativeShare', () => {
  it('returns exactly the original amount across several partial returns', () => {
    // Original line: qty 3, discount 10.00 -> thirds would drift with naive rounding.
    const a = cumulativeShare('10.00', '3', '0', '1');
    const b = cumulativeShare('10.00', '3', '1', '1');
    const c = cumulativeShare('10.00', '3', '2', '1');
    expect([a, b, c]).toEqual(['3.33', '3.34', '3.33']);
    expect((Number(a) * 100 + Number(b) * 100 + Number(c) * 100) / 100).toBe(10);
  });

  it('gives the full amount for a full return', () => {
    expect(cumulativeShare('114.00', '2', '0', '2')).toBe('114.00');
  });
});
