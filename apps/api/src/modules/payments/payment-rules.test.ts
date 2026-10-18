import { describe, expect, it } from 'vitest';
import { AppError } from '../../common/errors/app-error.js';
import { looksLikeCardNumber, primaryEtaPaymentCode, resolvePayments } from './payment-rules.js';

const policy = { enabledMethods: ['CASH', 'CARD', 'WALLET'] as const, requireCardAuthorizationRef: true };
const codes = (fn: () => unknown) => {
  try {
    fn();
    return [];
  } catch (e) {
    return (e as AppError).details.map((d) => d.code);
  }
};

describe('resolvePayments', () => {
  it('computes change for over-tendered cash', () => {
    const [p] = resolvePayments('114.00', [{ method: 'CASH', amount: '114.00', tendered: '200' }], policy);
    expect(p).toMatchObject({ amount: '114.00', tendered: '200.00', change: '86.00', status: 'CAPTURED' });
  });

  it('supports split tender that sums exactly to the total', () => {
    const r = resolvePayments('100.00', [{ method: 'CASH', amount: '40' }, { method: 'CARD', amount: '60', reference: 'AUTH123' }], policy);
    expect(r[1]).toMatchObject({ status: 'EXTERNALLY_AUTHORIZED', reference: 'AUTH123' });
  });

  it('never marks a card payment without terminal reference as captured', () => {
    expect(codes(() => resolvePayments('10', [{ method: 'CARD', amount: '10' }], policy))).toContain('REFERENCE_REQUIRED');
    const [p] = resolvePayments('10', [{ method: 'CARD', amount: '10' }], { ...policy, requireCardAuthorizationRef: false });
    expect(p!.status).toBe('PENDING_CONFIRMATION');
  });

  it('rejects mismatched totals, insufficient tender and disabled methods', () => {
    expect(codes(() => resolvePayments('100.00', [{ method: 'CASH', amount: '99.99' }], policy))).toContain('PAYMENT_MISMATCH');
    expect(codes(() => resolvePayments('100.00', [{ method: 'CASH', amount: '100', tendered: '50' }], policy))).toContain('INSUFFICIENT_TENDER');
    expect(codes(() => resolvePayments('10', [{ method: 'POINTS', amount: '10', reference: 'x' }], policy))).toContain('METHOD_DISABLED');
  });

  it('refuses card numbers entered as references', () => {
    expect(looksLikeCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(looksLikeCardNumber('AUTH-123456')).toBe(false);
    expect(codes(() => resolvePayments('10', [{ method: 'CARD', amount: '10', reference: '4111111111111111' }], policy))).toContain('CARD_NUMBER_REFUSED');
  });
});

describe('primaryEtaPaymentCode', () => {
  it('uses the largest tender', () => {
    expect(primaryEtaPaymentCode([{ method: 'CASH', amount: '10.00' }, { method: 'CARD', amount: '90.00' }])).toBe('V');
    expect(primaryEtaPaymentCode([{ method: 'CASH', amount: '50.00' }, { method: 'CARD', amount: '50.00' }])).toBe('C');
  });
});
