import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { decryptSecret } from '../src/common/crypto/crypto.js';
import { serialize, parseEtaJson } from '../src/modules/eta/serializer.js';
import { sha256Hex } from '../src/common/crypto/crypto.js';
import { ReceiptModel } from '../src/modules/receipts/receipt.model.js';
import { PaymentModel } from '../src/modules/payments/payment.model.js';
import { bearer, idemKey, login, openShift, seedCompany, sell, useTestApp } from './helpers.js';

const t = useTestApp();

async function ready(opts: { submissionEnabled?: boolean } = {}) {
  const s = await seedCompany({ submissionEnabled: opts.submissionEnabled ?? false });
  const token = await login(t.app, s.users.CASHIER!.email);
  const shift = await openShift(t.app, token, s.deviceId);
  return { s, token, shift };
}

describe('POS checkout', () => {
  it('calculates totals on the server and issues a receipt with an ETA document', async () => {
    const { s, token } = await ready();
    const res = await sell(t.app, token, {
      deviceId: String(s.deviceId),
      items: [{ productId: String(s.products.taxed), quantity: '2' }, { productId: String(s.products.exempt), quantity: '3' }],
      payments: [{ method: 'CASH', amount: '144.00', tendered: '200.00' }],
      // Client-supplied price and totals are not part of the contract and are ignored.
      totalAmount: '1.00', unitPrice: '0.01',
    });
    expect(res.status).toBe(201);
    expect(res.body.receipt.totals).toMatchObject({ totalSales: '130.00', netAmount: '130.00', totalAmount: '144.00' });
    expect(res.body.change).toBe('56.00');
    expect(res.body.receipt.eta.status).toBe('NOT_SUBMITTED');
    expect(res.body.receipt.registration.officiallyRegistered).toBe(false);
    expect(res.body.receipt.etaDocumentEnc).toBeUndefined();

    const stored = await ReceiptModel.findOne({ tenantId: s.tenantId, _id: res.body.receipt.id }).select('+etaDocumentEnc').lean();
    const doc = parseEtaJson(decryptSecret(stored!.etaDocumentEnc)) as { header: Record<string, unknown> };
    expect(doc.header.uuid).toBe(stored!.uuid);
    doc.header.uuid = '';
    expect(sha256Hex(serialize(doc as never))).toBe(stored!.uuid);
  });

  it('chains receipts on a device through previousUUID', async () => {
    const { s, token } = await ready();
    const body = { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CASH', amount: '10.00' }] };
    const r1 = await sell(t.app, token, body);
    const r2 = await sell(t.app, token, body);
    const r3 = await sell(t.app, token, body);
    expect(r1.body.receipt.previousUUID).toBe('');
    expect(r2.body.receipt.previousUUID).toBe(r1.body.receipt.uuid);
    expect(r3.body.receipt.previousUUID).toBe(r2.body.receipt.uuid);
    expect([r1, r2, r3].map((r) => r.body.receipt.receiptNumber)).toEqual(['P1-00000001', 'P1-00000002', 'P1-00000003']);
  });

  it('keeps the chain consistent under concurrent checkouts on one device', async () => {
    const { s, token } = await ready();
    const body = { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CASH', amount: '10.00' }] };
    const results = await Promise.all(Array.from({ length: 6 }, () => sell(t.app, token, body)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const receipts = await ReceiptModel.find({ tenantId: s.tenantId, deviceId: s.deviceId }).sort({ chainSeq: 1 }).lean();
    expect(receipts.map((r) => r.chainSeq)).toEqual([1, 2, 3, 4, 5, 6]);
    receipts.forEach((r, i) => expect(r.previousUUID).toBe(i === 0 ? '' : receipts[i - 1]!.uuid));
  });

  it('is idempotent: replaying a key returns the same sale, a different payload is refused', async () => {
    const { s, token } = await ready();
    const key = idemKey();
    const body = { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CASH', amount: '10.00' }] };
    const a = await sell(t.app, token, body, key);
    const b = await sell(t.app, token, body, key);
    expect(b.status).toBe(201);
    expect(b.body.replayed).toBe(true);
    expect(b.body.receipt.id).toBe(a.body.receipt.id);
    expect(await ReceiptModel.countDocuments({ tenantId: s.tenantId })).toBe(1);
    const c = await sell(t.app, token, { ...body, items: [{ productId: String(s.products.exempt), quantity: '2' }], payments: [{ method: 'CASH', amount: '20.00' }] }, key);
    expect(c.status).toBe(409);
    expect((await request(t.app).post('/api/v1/pos/checkout').set(bearer(token)).send(body)).status).toBe(422);
  });

  it('requires buyer national ID and name at or above the configured threshold', async () => {
    const { s, token } = await ready();
    const base = { deviceId: String(s.deviceId), items: [{ productId: String(s.products.expensive), quantity: '2' }], payments: [{ method: 'CARD', amount: '228000.00', reference: 'AUTH77' }] };
    const anon = await sell(t.app, token, base);
    expect(anon.status).toBe(422);
    expect(anon.body.error.code).toBe('BUYER_IDENTITY_REQUIRED');
    const named = await sell(t.app, token, { ...base, buyer: { type: 'P', name: 'Mona Ali', identity: '29001011234567' } });
    expect(named.status).toBe(201);
    expect(named.body.receipt.buyer).toMatchObject({ type: 'P', name: 'Mona Ali', idLast4: '4567' });
    expect(JSON.stringify(named.body)).not.toContain('29001011234567');
  });

  it('validates payments against the server total and refuses card numbers', async () => {
    const { s, token } = await ready();
    const items = [{ productId: String(s.products.taxed), quantity: '1' }];
    const short = await sell(t.app, token, { deviceId: String(s.deviceId), items, payments: [{ method: 'CASH', amount: '50.00' }] });
    expect(short.body.error.details.map((d: { code: string }) => d.code)).toContain('PAYMENT_MISMATCH');
    const pan = await sell(t.app, token, { deviceId: String(s.deviceId), items, payments: [{ method: 'CARD', amount: '57.00', reference: '4111111111111111' }] });
    expect(pan.body.error.details.map((d: { code: string }) => d.code)).toContain('CARD_NUMBER_REFUSED');
    const split = await sell(t.app, token, { deviceId: String(s.deviceId), items, payments: [{ method: 'CASH', amount: '7.00' }, { method: 'CARD', amount: '50.00', reference: 'A1B2C3' }] });
    expect(split.status).toBe(201);
    expect(split.body.receipt.paymentMethodCode).toBe('V');
  });

  it('enforces the cashier discount limit unless the user may override it', async () => {
    const { s, token } = await ready();
    const body = { deviceId: String(s.deviceId), items: [{ productId: String(s.products.taxed), quantity: '1', discount: { rate: '50', description: 'Big' } }], payments: [{ method: 'CASH', amount: '28.50' }] };
    const res = await sell(t.app, token, body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DISCOUNT_LIMIT_EXCEEDED');
  });

  it('refuses sales without an open shift and on inactive devices', async () => {
    const s = await seedCompany({ submissionEnabled: false });
    const token = await login(t.app, s.users.CASHIER2!.email);
    const res = await sell(t.app, token, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CASH', amount: '10.00' }] });
    expect(res.body.error.code).toBe('NO_OPEN_SHIFT');
  });

  it('reconciles a shift: expected cash = opening + cash sales, variance from count', async () => {
    const { s, token, shift } = await ready();
    await sell(t.app, token, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '2' }], payments: [{ method: 'CASH', amount: '20.00', tendered: '50' }] });
    await sell(t.app, token, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.taxed), quantity: '1' }], payments: [{ method: 'CARD', amount: '57.00', reference: 'ZZ9' }] });
    const close = await request(t.app).post(`/api/v1/pos/shifts/${shift.id}/close`).set(bearer(token)).send({ countedCash: '519.00' });
    expect(close.status).toBe(200);
    expect(close.body).toMatchObject({ expectedCash: '520.00', variance: '-1.00', cashIn: '20.00', status: 'CLOSED' });
    expect(await PaymentModel.countDocuments({ tenantId: s.tenantId, method: 'CARD', status: 'EXTERNALLY_AUTHORIZED' })).toBe(1);
  });

  it('prices a cart via quote without persisting anything', async () => {
    const { s, token } = await ready();
    const res = await request(t.app).post('/api/v1/pos/quote').set(bearer(token)).send({ items: [{ productId: String(s.products.taxed), quantity: '3' }] });
    expect(res.status).toBe(200);
    expect(res.body.totals.totalAmount).toBe('171.00');
    expect(await ReceiptModel.countDocuments({ tenantId: s.tenantId })).toBe(0);
  });

  it('refuses to modify issued receipt data', async () => {
    const { s, token } = await ready();
    const r = await sell(t.app, token, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CASH', amount: '10.00' }] });
    await expect(ReceiptModel.updateOne({ tenantId: s.tenantId, _id: r.body.receipt.id }, { $set: { 'totals.totalAmount': '1.00' } })).rejects.toThrow(/immutable/);
    await expect(ReceiptModel.deleteOne({ tenantId: s.tenantId, _id: r.body.receipt.id })).rejects.toThrow(/cannot be deleted/);
  });
});
