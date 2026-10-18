import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../core/api/models';
import { PosCartStore } from './pos-cart.store';

const product = (id: string): Product => ({
  id, kind: 'GOODS', internalCode: id, barcode: null, nameAr: id, nameEn: null, description: id, etaItemType: 'EGS', etaItemCode: 'X',
  etaCodeStatus: 'APPROVED', unitType: 'EA', unitPrice: '10.00', taxCodes: ['VAT'], isActive: true,
});

describe('PosCartStore', () => {
  let store: PosCartStore;
  let ctl: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [PosCartStore, provideHttpClient(), provideHttpClientTesting()] });
    store = TestBed.inject(PosCartStore);
    ctl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => vi.useRealTimers());

  it('prices the cart on the server, debounced, and never computes totals itself', () => {
    store.add(product('a'));
    store.add(product('a'));
    store.add(product('b'));
    vi.advanceTimersByTime(200);
    const req = ctl.expectOne('/api/v1/pos/quote');
    expect(req.request.body).toEqual({ items: [{ productId: 'a', quantity: '2' }, { productId: 'b', quantity: '1' }] });
    req.flush({ policyVersion: 'x', lines: [], totals: { totalAmount: '34.20' } });
    expect(store.quote()?.totals.totalAmount).toBe('34.20');
    ctl.verify();
  });

  it('uses a new idempotency key whenever the cart changes', () => {
    const k1 = store.idempotencyKey();
    store.add(product('a'));
    const k2 = store.idempotencyKey();
    expect(k2).not.toBe(k1);
    store.setDiscount(0, '5');
    expect(store.idempotencyKey()).not.toBe(k2);
  });

  it('rejects invalid quantities and discounts', () => {
    store.add(product('a'));
    store.setQuantity(0, '-1');
    store.setQuantity(0, 'abc');
    store.setDiscount(0, '150');
    expect(store.lines()[0]).toMatchObject({ quantity: '1', discountRate: '' });
    store.step(0, -1);
    expect(store.isEmpty()).toBe(true);
  });
});
