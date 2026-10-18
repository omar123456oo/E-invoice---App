import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { decryptSecret } from '../src/common/crypto/crypto.js';
import { ReceiptModel } from '../src/modules/receipts/receipt.model.js';
import { SalesTransactionModel } from '../src/modules/sales/sales-transaction.model.js';
import { bearer, idemKey, login, openShift, seedCompany, sell, useTestApp } from './helpers.js';

const t = useTestApp();

async function setup(submissionEnabled = false) {
  const s = await seedCompany({ submissionEnabled });
  const cashier = await login(t.app, s.users.CASHIER!.email);
  const shift = await openShift(t.app, cashier, s.deviceId);
  // 3 × 50.00 with a 10.00 discount, 14% VAT (test rate): net 140.00, tax 19.60, total 159.60
  const sale = await sell(t.app, cashier, {
    deviceId: String(s.deviceId),
    items: [{ productId: String(s.products.taxed), quantity: '3', discount: { amount: '10', description: 'Promo' } }, { productId: String(s.products.exempt), quantity: '1' }],
    payments: [{ method: 'CASH', amount: '169.60' }],
  });
  expect(sale.status).toBe(201);
  return { s, cashier, shift, receipt: sale.body.receipt };
}

const createReturn = (token: string, body: Record<string, unknown>) =>
  request(t.app).post('/api/v1/returns').set(bearer(token)).set('Idempotency-Key', idemKey()).send(body);

describe('returns and refunds', () => {
  it('issues a partial return receipt that references the original UUID with proportional amounts', async () => {
    const { s, cashier, receipt } = await setup();
    const req = await createReturn(cashier, { originalReceiptId: receipt.id, lines: [{ lineNo: 1, quantity: '1' }], reason: 'Damaged', refundMethod: 'CASH' });
    expect(req.status).toBe(201);
    expect(req.body.return.status).toBe('APPROVED');
    const done = await request(t.app).post(`/api/v1/returns/${req.body.return.id}/complete`).set(bearer(cashier)).send({ deviceId: String(s.deviceId) });
    expect(done.status).toBe(200);
    const rr = done.body.receipt;
    expect(rr.kind).toBe('RETURN');
    expect(rr.referenceUUID).toBe(receipt.uuid);
    expect(rr.previousUUID).toBe(receipt.uuid); // same device chain
    expect(rr.lines[0]).toMatchObject({ quantity: '1', totalSale: '50.00', netSale: '46.67', total: '53.20', originalLineNo: 1 });
    expect(rr.lines[0].commercialDiscount.amount).toBe('3.33');
    const stored = await ReceiptModel.findOne({ tenantId: s.tenantId, _id: rr.id }).select('+etaDocumentEnc').lean();
    const doc = JSON.parse(decryptSecret(stored!.etaDocumentEnc));
    expect(doc.documentType).toEqual({ receiptType: 'r', typeVersion: '1.2' });
    expect(doc.header.referenceUUID).toBe(receipt.uuid);
    const original = await ReceiptModel.findOne({ tenantId: s.tenantId, _id: receipt.id }).lean();
    expect(original!.returnStatus).toBe('PARTIAL');
  });

  it('returns exactly the original amounts once every unit has been returned across several returns', async () => {
    const { s, cashier, receipt } = await setup();
    let refunded = 0;
    for (const qty of ['1', '1', '1']) {
      const r = await createReturn(cashier, { originalReceiptId: receipt.id, lines: [{ lineNo: 1, quantity: qty }], reason: 'Change of mind', refundMethod: 'CASH' });
      const c = await request(t.app).post(`/api/v1/returns/${r.body.return.id}/complete`).set(bearer(cashier)).send({ deviceId: String(s.deviceId) });
      expect(c.status).toBe(200);
      refunded += Math.round(Number(c.body.receipt.totals.totalAmount) * 100);
    }
    expect(refunded).toBe(15960);
    const again = await createReturn(cashier, { originalReceiptId: receipt.id, lines: [{ lineNo: 1, quantity: '1' }], reason: 'Customer return', refundMethod: 'CASH' });
    expect(again.status).toBe(422);
    expect(again.body.error.details[0].code).toBe('EXCEEDS_RETURNABLE');
    const tx = await SalesTransactionModel.findOne({ tenantId: s.tenantId, receiptId: receipt.id }).lean();
    expect(tx!.status).toBe('PARTIALLY_RETURNED');
    expect(tx!.amountRefunded.toString()).toBe('159.60');
  });

  it('requires approval above the configured amount and forbids self-approval', async () => {
    const s = await seedCompany({ submissionEnabled: false });
    const cashier = await login(t.app, s.users.CASHIER!.email);
    await openShift(t.app, cashier, s.deviceId);
    const sale = await sell(t.app, cashier, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.taxed), quantity: '100' }], payments: [{ method: 'CARD', amount: '5700.00', reference: 'AUTH5700' }] });
    const req = await createReturn(cashier, { originalReceiptId: sale.body.receipt.id, lines: [{ lineNo: 1, quantity: '100' }], reason: 'Wrong order', refundMethod: 'CARD', refundReference: 'RFND1' });
    expect(req.body.return).toMatchObject({ status: 'PENDING_APPROVAL', requiresApprovalReasons: ['AMOUNT_ABOVE_LIMIT'] });
    const early = await request(t.app).post(`/api/v1/returns/${req.body.return.id}/complete`).set(bearer(cashier)).send({ deviceId: String(s.deviceId) });
    expect(early.body.error.code).toBe('INVALID_RETURN_STATE');
    expect((await request(t.app).post(`/api/v1/returns/${req.body.return.id}/decision`).set(bearer(cashier)).send({ approve: true })).status).toBe(403);
    const manager = await login(t.app, s.users.FINANCE_MANAGER!.email);
    const ok = await request(t.app).post(`/api/v1/returns/${req.body.return.id}/decision`).set(bearer(manager)).send({ approve: true, notes: 'checked' });
    expect(ok.body.status).toBe('APPROVED');
    const done = await request(t.app).post(`/api/v1/returns/${req.body.return.id}/complete`).set(bearer(cashier)).send({ deviceId: String(s.deviceId) });
    expect(done.status).toBe(200);
    expect(done.body.receipt.paymentMethodCode).toBe('V');
  });

  it('counts cash refunds in the shift reconciliation', async () => {
    const { s, cashier, shift, receipt } = await setup();
    const r = await createReturn(cashier, { originalReceiptId: receipt.id, lines: [{ lineNo: 2, quantity: '1' }], reason: 'Customer return', refundMethod: 'CASH' });
    await request(t.app).post(`/api/v1/returns/${r.body.return.id}/complete`).set(bearer(cashier)).send({ deviceId: String(s.deviceId) });
    const close = await request(t.app).post(`/api/v1/pos/shifts/${shift.id}/close`).set(bearer(cashier)).send({ countedCash: '659.60' });
    expect(close.body).toMatchObject({ cashIn: '169.60', cashOut: '10.00', expectedCash: '659.60', variance: '0.00' });
  });

  it('holds a return receipt until the original sale is VALID at ETA (SIMULATED ETA)', async () => {
    t.eta.behaviour = 'accept';
    t.eta.validationOutcome = () => 'Valid';
    const { s, cashier, receipt } = await setup(true);
    const r = await createReturn(cashier, { originalReceiptId: receipt.id, lines: [{ lineNo: 2, quantity: '1' }], reason: 'Customer return', refundMethod: 'CASH' });
    const done = await request(t.app).post(`/api/v1/returns/${r.body.return.id}/complete`).set(bearer(cashier)).send({ deviceId: String(s.deviceId) });
    // First run sends only the sale; the return waits for the original to be validated.
    const first = await t.service.submitDevice(s.tenantId, s.deviceId);
    expect(first.accepted).toBe(1);
    expect((await ReceiptModel.findOne({ tenantId: s.tenantId, _id: done.body.receipt.id }).lean())!.eta.status).toBe('QUEUED');
    expect((await t.service.submitDevice(s.tenantId, s.deviceId)).reason).toBe('WAITING_FOR_ORIGINAL');
    const sale = await ReceiptModel.findOne({ tenantId: s.tenantId, _id: receipt.id }).lean();
    await t.service.pollSubmission(s.tenantId, sale!.eta.submissionUuid!);
    expect((await t.service.submitDevice(s.tenantId, s.deviceId)).accepted).toBe(1);
  });

  it('refuses returns against receipts rejected by ETA', async () => {
    t.eta.behaviour = 'reject-all';
    const { s, cashier, receipt } = await setup(true);
    await t.service.submitDevice(s.tenantId, s.deviceId);
    const r = await createReturn(cashier, { originalReceiptId: receipt.id, lines: [{ lineNo: 2, quantity: '1' }], reason: 'Customer return', refundMethod: 'CASH' });
    expect(r.body.error.code).toBe('ORIGINAL_NOT_RETURNABLE');
    t.eta.behaviour = 'accept';
  });

  it('refuses a cash refund larger than the cash in the drawer', async () => {
    const s = await seedCompany({ submissionEnabled: false });
    const cashier = await login(t.app, s.users.CASHIER!.email);
    await openShift(t.app, cashier, s.deviceId, '0.00');
    const sale = await sell(t.app, cashier, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.taxed), quantity: '1' }], payments: [{ method: 'CARD', amount: '57.00', reference: 'C77' }] });
    const r = await createReturn(cashier, { originalReceiptId: sale.body.receipt.id, lines: [{ lineNo: 1, quantity: '1' }], reason: 'Customer return', refundMethod: 'CASH' });
    const done = await request(t.app).post(`/api/v1/returns/${r.body.return.id}/complete`).set(bearer(cashier)).send({ deviceId: String(s.deviceId) });
    expect(done.body.error.code).toBe('INSUFFICIENT_DRAWER_CASH');
  });
});
