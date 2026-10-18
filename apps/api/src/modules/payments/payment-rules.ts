import { AppError, type ErrorDetail } from '../../common/errors/app-error.js';
import { dec, Decimal, sum } from '../../common/money/decimal.js';
import type { PaymentMethod } from '../tenants/tenant.model.js';
import { ETA_PAYMENT_CODES } from '../eta/receipt-document.js';

export interface PaymentInput {
  method: PaymentMethod;
  amount: string;
  tendered?: string;
  reference?: string;
}

export interface ResolvedPayment {
  method: PaymentMethod;
  amount: string;
  tendered: string | null;
  change: string | null;
  status: 'CAPTURED' | 'EXTERNALLY_AUTHORIZED' | 'PENDING_CONFIRMATION';
  reference: string | null;
}

/** Luhn check, used to refuse anything that looks like a full card number (PAN). */
export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return total % 10 === 0;
}

export interface PaymentPolicy {
  enabledMethods: readonly PaymentMethod[];
  requireCardAuthorizationRef: boolean;
}

/**
 * Validates tender against the server-calculated total. The sum of applied
 * amounts must equal the total exactly; cash may be over-tendered and change
 * is computed. Non-cash methods are never marked captured by this system.
 */
export function resolvePayments(total: string, payments: PaymentInput[], policy: PaymentPolicy): ResolvedPayment[] {
  const errors: ErrorDetail[] = [];
  if (payments.length === 0) errors.push({ path: 'payments', message: 'At least one payment is required', code: 'NO_PAYMENT' });
  if (payments.length > 10) errors.push({ path: 'payments', message: 'At most 10 payments per sale', code: 'TOO_MANY_PAYMENTS' });

  const resolved = payments.map((p, i): ResolvedPayment => {
    const path = `payments.${i}`;
    const amount = dec(p.amount);
    if (!policy.enabledMethods.includes(p.method)) errors.push({ path: `${path}.method`, message: `Payment method ${p.method} is not enabled`, code: 'METHOD_DISABLED' });
    if (amount.lte(0)) errors.push({ path: `${path}.amount`, message: 'Amount must be positive', code: 'INVALID_AMOUNT' });
    if (amount.decimalPlaces() > 2) errors.push({ path: `${path}.amount`, message: 'Amount has more than 2 decimals', code: 'INVALID_AMOUNT' });
    if (p.reference && looksLikeCardNumber(p.reference)) errors.push({ path: `${path}.reference`, message: 'Never enter a card number. Use the terminal authorization code', code: 'CARD_NUMBER_REFUSED' });

    if (p.method === 'CASH') {
      const tendered = p.tendered ? dec(p.tendered) : amount;
      if (tendered.lt(amount)) errors.push({ path: `${path}.tendered`, message: 'Tendered cash is less than the amount', code: 'INSUFFICIENT_TENDER' });
      return { method: p.method, amount: amount.toFixed(2), tendered: tendered.toFixed(2), change: tendered.minus(amount).toFixed(2), status: 'CAPTURED', reference: null };
    }
    if (p.tendered) errors.push({ path: `${path}.tendered`, message: 'Tendered applies to cash only', code: 'INVALID_TENDER' });
    const needsRef = p.method === 'CARD' ? policy.requireCardAuthorizationRef : p.method !== 'OTHER';
    if (needsRef && !p.reference) errors.push({ path: `${path}.reference`, message: 'An authorization/reference code is required', code: 'REFERENCE_REQUIRED' });
    return { method: p.method, amount: amount.toFixed(2), tendered: null, change: null, status: p.reference ? 'EXTERNALLY_AUTHORIZED' : 'PENDING_CONFIRMATION', reference: p.reference ?? null };
  });

  if (errors.length === 0) {
    const paid = sum(resolved.map((r) => r.amount));
    if (!paid.eq(dec(total))) {
      errors.push({ path: 'payments', message: `Payments total ${paid.toFixed(2)} must equal receipt total ${dec(total).toFixed(2)}`, code: 'PAYMENT_MISMATCH' });
    }
  }
  if (errors.length) throw AppError.validation(errors, 'Payment validation failed');
  return resolved;
}

/**
 * The receipt carries a single ETA paymentMethod. For split tender the method
 * with the largest amount is used (ties: first entered). This is an
 * implementation assumption pending ETA confirmation (compliance matrix).
 */
export function primaryEtaPaymentCode(payments: Array<{ method: PaymentMethod; amount: string }>): string {
  let best = payments[0]!;
  for (const p of payments) if (new Decimal(p.amount).gt(best.amount)) best = p;
  return ETA_PAYMENT_CODES[best.method];
}
