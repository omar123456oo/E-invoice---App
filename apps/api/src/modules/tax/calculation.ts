import { dec, Decimal, round, sum, type RoundingMode } from '../../common/money/decimal.js';
import { AppError, type ErrorDetail } from '../../common/errors/app-error.js';

/**
 * Receipt calculation engine. Pure and deterministic: identical inputs give
 * identical outputs, and nothing here reads the clock, the database or the
 * client-supplied totals. Field names follow ETA receipt v1.2 itemData/totals.
 *
 * Calculation policy (POLICY_VERSION) — see docs/compliance-matrix.md:
 *  - totalSale = quantity × unitPrice, rounded to 2 dp.
 *  - commercial discount (reduces the taxable base): amount, or rate × totalSale, rounded to 2 dp.
 *  - netSale = totalSale − commercial discount.
 *  - PERCENTAGE tax = netSale × rate / 100, rounded to 2 dp per line ("precision of 2" in receipt v1.2).
 *  - item (non-taxable) discount is subtracted after tax.
 *  - total = netSale + Σ taxes − item discount.
 *  - extra receipt discount is subtracted from Σ line totals (receipt v1.2 totals.totalAmount).
 *  The rounding scale and mode are an implementation assumption pending
 *  confirmation by a qualified Egyptian tax professional.
 */
export const POLICY_VERSION = 'calc-2026-10-18.1';
export const AMOUNT_SCALE = 2;
export const ROUNDING: RoundingMode = 'HALF_UP';

/** Tax treatments whose calculation is implemented. Others must be reviewed before use. */
export const SUPPORTED_TREATMENTS: ReadonlyArray<{ taxType: string; treatment: 'PERCENTAGE' | 'EXEMPT' }> = [
  { taxType: 'T1', treatment: 'PERCENTAGE' },
  { taxType: 'T1', treatment: 'EXEMPT' },
];

export interface TaxRuleSnapshot {
  code: string;
  version: number;
  etaTaxType: string;
  etaSubType: string;
  treatment: 'PERCENTAGE' | 'EXEMPT';
  rate: string;
}

export interface DiscountInput {
  /** Percentage 0–100. Takes precedence over amount when > 0 (receipt v1.2 discount.rate). */
  rate?: string;
  amount?: string;
  description: string;
}

export interface LineInput {
  lineNo: number;
  quantity: string;
  unitPrice: string;
  commercialDiscount?: DiscountInput;
  itemDiscount?: DiscountInput;
  taxes: TaxRuleSnapshot[];
}

export interface TaxLineResult {
  taxType: string;
  subType: string;
  rate: string;
  amount: string;
}

export interface DiscountResult {
  rate: string | null;
  amount: string;
  description: string;
}

export interface LineResult {
  lineNo: number;
  quantity: string;
  unitPrice: string;
  totalSale: string;
  commercialDiscount: DiscountResult | null;
  netSale: string;
  taxableItems: TaxLineResult[];
  itemDiscount: DiscountResult | null;
  total: string;
}

export interface ReceiptTotals {
  totalSales: string;
  totalCommercialDiscount: string;
  totalItemsDiscount: string;
  netAmount: string;
  extraReceiptDiscount: DiscountResult | null;
  taxTotals: Array<{ taxType: string; amount: string }>;
  totalAmount: string;
}

export interface CalculationResult {
  policyVersion: string;
  lines: LineResult[];
  totals: ReceiptTotals;
}

const r = (v: Decimal | string): Decimal => round(v, AMOUNT_SCALE, ROUNDING);
const s = (v: Decimal): string => v.toFixed(AMOUNT_SCALE);

export function assertSupported(rule: Pick<TaxRuleSnapshot, 'etaTaxType' | 'treatment' | 'rate'>): void {
  const ok = SUPPORTED_TREATMENTS.some((t) => t.taxType === rule.etaTaxType && t.treatment === rule.treatment);
  if (!ok) {
    throw AppError.businessRule(
      `Tax treatment ${rule.etaTaxType}/${rule.treatment} is not supported by the calculation engine and requires review`,
      'UNSUPPORTED_TAX_TREATMENT',
    );
  }
  const rate = dec(rule.rate);
  if (rate.lt(0) || rate.gt(100)) throw AppError.businessRule('Tax rate must be between 0 and 100', 'INVALID_TAX_RATE');
  if (rule.treatment === 'EXEMPT' && !rate.isZero()) throw AppError.businessRule('Exempt treatment must have a zero rate', 'INVALID_TAX_RATE');
}

function applyDiscount(base: Decimal, d: DiscountInput | undefined, path: string, errors: ErrorDetail[]): DiscountResult | null {
  if (!d) return null;
  const rate = d.rate !== undefined ? dec(d.rate) : null;
  let amount: Decimal;
  if (rate && rate.gt(0)) {
    if (rate.gt(100)) errors.push({ path: `${path}.rate`, message: 'Discount rate cannot exceed 100', code: 'INVALID_DISCOUNT' });
    amount = r(base.times(rate).div(100));
  } else {
    amount = r(dec(d.amount ?? '0'));
  }
  if (amount.lt(0)) errors.push({ path, message: 'Discount cannot be negative', code: 'INVALID_DISCOUNT' });
  if (amount.gt(base)) errors.push({ path, message: 'Discount cannot exceed the amount it applies to', code: 'INVALID_DISCOUNT' });
  if (amount.isZero()) return null;
  return { rate: rate && rate.gt(0) ? rate.toFixed() : null, amount: s(amount), description: d.description.slice(0, 50) };
}

export function calculateReceipt(lines: LineInput[], extraDiscount?: DiscountInput): CalculationResult {
  const errors: ErrorDetail[] = [];
  if (lines.length === 0) errors.push({ path: 'lines', message: 'At least one line is required', code: 'EMPTY_RECEIPT' });
  // ETA Receipt Issuance FAQ: maximum 300 line items per receipt.
  if (lines.length > 300) errors.push({ path: 'lines', message: 'A receipt may contain at most 300 lines', code: 'TOO_MANY_LINES' });

  const results: LineResult[] = lines.map((line, idx) => {
    const path = `lines.${idx}`;
    const quantity = dec(line.quantity);
    const unitPrice = dec(line.unitPrice);
    if (quantity.lte(0)) errors.push({ path: `${path}.quantity`, message: 'Quantity must be greater than zero', code: 'INVALID_QUANTITY' });
    if (unitPrice.lt(0)) errors.push({ path: `${path}.unitPrice`, message: 'Unit price cannot be negative', code: 'INVALID_PRICE' });

    const totalSale = r(quantity.times(unitPrice));
    const commercialDiscount = applyDiscount(totalSale, line.commercialDiscount, `${path}.commercialDiscount`, errors);
    const netSale = totalSale.minus(commercialDiscount?.amount ?? '0');

    const seen = new Set<string>();
    const taxableItems = line.taxes.map((t) => {
      assertSupported(t);
      // receipt v1.2: taxType must be unique within the line.
      if (seen.has(t.etaTaxType)) errors.push({ path: `${path}.taxes`, message: `Tax type ${t.etaTaxType} applied twice`, code: 'DUPLICATE_TAX_TYPE' });
      seen.add(t.etaTaxType);
      const amount = t.treatment === 'EXEMPT' ? new Decimal(0) : r(netSale.times(t.rate).div(100));
      return { taxType: t.etaTaxType, subType: t.etaSubType, rate: dec(t.rate).toFixed(), amount: s(amount) };
    });
    if (taxableItems.length === 0) errors.push({ path: `${path}.taxes`, message: 'Every line needs a tax treatment (use an exempt rule where applicable)', code: 'MISSING_TAX' });

    const taxSum = sum(taxableItems.map((t) => t.amount));
    const afterTax = netSale.plus(taxSum);
    const itemDiscount = applyDiscount(afterTax, line.itemDiscount, `${path}.itemDiscount`, errors);
    const total = afterTax.minus(itemDiscount?.amount ?? '0');

    return {
      lineNo: line.lineNo,
      quantity: quantity.toFixed(),
      unitPrice: unitPrice.toFixed(),
      totalSale: s(totalSale),
      commercialDiscount,
      netSale: s(netSale),
      taxableItems,
      itemDiscount,
      total: s(total),
    };
  });

  const linesTotal = sum(results.map((l) => l.total));
  const extra = applyDiscount(linesTotal, extraDiscount, 'extraDiscount', errors);
  if (errors.length) throw AppError.validation(errors, 'Receipt calculation failed');

  return { policyVersion: POLICY_VERSION, lines: results, totals: buildTotals(results, extra) };
}

export function buildTotals(results: LineResult[], extra: DiscountResult | null): ReceiptTotals {
  const taxMap = new Map<string, Decimal>();
  for (const l of results) for (const t of l.taxableItems) taxMap.set(t.taxType, (taxMap.get(t.taxType) ?? new Decimal(0)).plus(t.amount));
  const linesTotal = sum(results.map((l) => l.total));
  return {
    totalSales: s(sum(results.map((l) => l.totalSale))),
    totalCommercialDiscount: s(sum(results.map((l) => l.commercialDiscount?.amount ?? '0'))),
    totalItemsDiscount: s(sum(results.map((l) => l.itemDiscount?.amount ?? '0'))),
    netAmount: s(sum(results.map((l) => l.netSale))),
    extraReceiptDiscount: extra,
    taxTotals: [...taxMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([taxType, amount]) => ({ taxType, amount: s(amount) })),
    totalAmount: s(linesTotal.minus(extra?.amount ?? '0')),
  };
}

/**
 * Proportional share of an original amount for a (partial) return, computed
 * cumulatively so that returning every unit across several returns gives
 * back exactly the original amount, with no rounding drift.
 */
export function cumulativeShare(originalAmount: string, originalQty: string, previouslyReturnedQty: string, returnQty: string): string {
  const orig = dec(originalAmount);
  const oq = dec(originalQty);
  const before = r(orig.times(dec(previouslyReturnedQty)).div(oq));
  const after = r(orig.times(dec(previouslyReturnedQty).plus(returnQty)).div(oq));
  return s(after.minus(before));
}
