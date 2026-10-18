import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { decryptSecret, sha256Hex } from '../src/common/crypto/crypto.js';
import { parseEtaJson, serialize } from '../src/modules/eta/serializer.js';
import { ProductModel } from '../src/modules/products/product.model.js';
import { ReceiptModel } from '../src/modules/receipts/receipt.model.js';
import { SalesTransactionModel } from '../src/modules/sales/sales-transaction.model.js';
import { bearer, login, openShift, seedCompany, sell, useTestApp } from './helpers.js';

// ETA responses come from the SIMULATED ETA.
const t = useTestApp();

async function rejectedSale() {
  const s = await seedCompany({ submissionEnabled: true });
  const cashier = await login(t.app, s.users.CASHIER!.email);
  await openShift(t.app, cashier, s.deviceId);
  const a = await sell(t.app, cashier, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.taxed), quantity: '1' }], payments: [{ method: 'CASH', amount: '57.00' }] });
  t.eta.behaviour = 'reject-all';
  await t.service.submitDevice(s.tenantId, s.deviceId);
  t.eta.behaviour = 'accept';
  const b = await sell(t.app, cashier, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CASH', amount: '10.00' }] });
  const manager = await login(t.app, s.users.FINANCE_MANAGER!.email);
  return { s, cashier, manager, rejected: a.body.receipt, later: b.body.receipt };
}

describe('receipt corrections (referenceOldUUID)', () => {
  it('issues a corrected receipt with a new UUID, the same previousUUID and referenceOldUUID', async () => {
    const { s, manager, rejected, later } = await rejectedSale();
    expect(later.previousUUID).toBe(rejected.uuid);
    await ProductModel.updateOne({ tenantId: s.tenantId, _id: s.products.taxed }, { $set: { etaItemCode: 'EG-FIXED-1' } });
    const res = await request(t.app).post(`/api/v1/receipts/${rejected.id}/correct`).set(bearer(manager)).send({ reason: 'Item code corrected', useCurrentProductCodes: true });
    expect(res.status).toBe(201);
    const c = res.body;
    expect(c.uuid).not.toBe(rejected.uuid);
    expect(c).toMatchObject({ previousUUID: rejected.previousUUID, referenceOldUUID: rejected.uuid, receiptNumber: rejected.receiptNumber, correctionSeq: 1, chainSeq: rejected.chainSeq });
    expect(c.totals).toEqual(rejected.totals);
    expect(c.lines[0].itemCode).toBe('EG-FIXED-1');
    expect(c.eta.status).toBe('QUEUED');

    const stored = await ReceiptModel.findOne({ tenantId: s.tenantId, _id: c.id }).select('+etaDocumentEnc').lean();
    const doc = parseEtaJson(decryptSecret(stored!.etaDocumentEnc)) as { header: Record<string, unknown>; itemData: Array<Record<string, unknown>> };
    expect(Object.keys(doc.header).slice(0, 5)).toEqual(['dateTimeIssued', 'receiptNumber', 'uuid', 'previousUUID', 'referenceOldUUID']);
    expect(doc.header.referenceOldUUID).toBe(rejected.uuid);
    expect(doc.itemData[0]!.itemCode).toBe('EG-FIXED-1');
    doc.header.uuid = '';
    expect(sha256Hex(serialize(doc as never))).toBe(c.uuid);

    const old = await ReceiptModel.findOne({ tenantId: s.tenantId, _id: rejected.id }).lean();
    expect(old!.eta.status).toBe('SUPERSEDED');
    expect(String(old!.eta.supersededBy)).toBe(c.id);
    const tx = await SalesTransactionModel.findOne({ tenantId: s.tenantId, _id: rejected.transactionId }).lean();
    expect(String(tx!.receiptId)).toBe(c.id);
    // The later receipt keeps referencing the original UUID (FAQ: later receipts keep their content).
    expect((await ReceiptModel.findOne({ tenantId: s.tenantId, _id: later.id }).lean())!.previousUUID).toBe(rejected.uuid);

    const sub = await t.service.submitDevice(s.tenantId, s.deviceId);
    expect(sub.outcome).toBe('SUBMITTED');
    const sent = t.eta.calls.filter((x) => x.op === 'submit').at(-1)!.body!;
    expect(sent.indexOf(c.uuid)).toBeLessThan(sent.indexOf(later.uuid));
  });

  it('refuses corrections that change nothing, of valid receipts, by cashiers, or after 96 hours', async () => {
    const { s, cashier, manager, rejected, later } = await rejectedSale();
    expect((await request(t.app).post(`/api/v1/receipts/${rejected.id}/correct`).set(bearer(cashier)).send({ reason: 'try' })).status).toBe(403);
    const same = await request(t.app).post(`/api/v1/receipts/${rejected.id}/correct`).set(bearer(manager)).send({ reason: 'nothing' });
    expect(same.body.error.code).toBe('NOTHING_TO_CORRECT');
    const notAllowed = await request(t.app).post(`/api/v1/receipts/${later.id}/correct`).set(bearer(manager)).send({ reason: 'not allowed', lines: [{ lineNo: 1, itemCode: 'X' }] });
    expect(notAllowed.body.error.code).toBe('NOT_CORRECTABLE');
    await ReceiptModel.collection.updateOne({ _id: (await ReceiptModel.findOne({ tenantId: s.tenantId, _id: rejected.id }).lean())!._id }, { $set: { dateTimeIssued: new Date(Date.now() - 97 * 3600_000) } });
    const late = await request(t.app).post(`/api/v1/receipts/${rejected.id}/correct`).set(bearer(manager)).send({ reason: 'late', lines: [{ lineNo: 1, itemCode: 'Y' }] });
    expect(late.body.error.code).toBe('CORRECTION_WINDOW_EXPIRED');
  });
});
