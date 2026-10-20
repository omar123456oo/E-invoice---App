import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { verifyChain } from '../src/modules/audit/audit.service.js';
import { bearer, idemKey, login, openShift, seedCompany, sell, useTestApp } from './helpers.js';

const t = useTestApp();

describe('audit trail', () => {
  it('is hash-chained and detects tampering', async () => {
    const s = await seedCompany();
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    await request(t.app).patch(`/api/v1/products/${s.products.taxed}`).set(bearer(owner)).send({ unitPrice: '55.00' });
    // A no-op update records an empty diff `{}`, which must be stored as-is to keep its hash valid.
    await request(t.app).patch('/api/v1/company').set(bearer(owner)).send({ contact: { phone: '+20200000000' } });
    await request(t.app).patch('/api/v1/company').set(bearer(owner)).send({ contact: { phone: '+20200000000' } });
    const ok =await request(t.app).get('/api/v1/audit-events/verify').set(bearer(owner));
    expect(ok.body.valid).toBe(true);
    expect(ok.body.checked).toBeGreaterThanOrEqual(2);

    const events = await request(t.app).get('/api/v1/audit-events?action=product.updated').set(bearer(owner));
    expect(events.body.items[0].changes.unitPrice).toEqual({ from: '50.00', to: '55.00' });

    // Simulate an attacker editing the database directly (bypassing the application).
    await mongoose.connection.collection('auditEvents').updateOne({ tenantId: s.tenantId, action: 'product.updated' }, { $set: { summary: 'nothing happened' } });
    const broken = await verifyChain(s.tenantId);
    expect(broken.valid).toBe(false);
  });

  it('never stores secrets in audit changes', async () => {
    const s = await seedCompany();
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    await request(t.app).put(`/api/v1/pos-devices/${s.deviceId}/eta-credentials`).set(bearer(owner)).send({ clientId: 'cid', clientSecret: 'super-secret-value', presharedKey: 'psk-value' });
    const raw = JSON.stringify(await mongoose.connection.collection('auditEvents').find({ tenantId: s.tenantId }).toArray());
    expect(raw).not.toContain('super-secret-value');
    expect(raw).not.toContain('psk-value');
    const devices = await request(t.app).get('/api/v1/pos-devices').set(bearer(owner));
    expect(JSON.stringify(devices.body)).not.toContain('etaCredentialsEnc');
    expect(devices.body[0].credentialsConfigured).toBe(true);
  });
});

describe('dashboard and reports', () => {
  it('aggregates persisted sales, returns, taxes and payments', async () => {
    const s = await seedCompany({ submissionEnabled: false });
    const cashier = await login(t.app, s.users.CASHIER!.email);
    await openShift(t.app, cashier, s.deviceId);
    const a = await sell(t.app, cashier, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.taxed), quantity: '2' }], payments: [{ method: 'CASH', amount: '114.00' }] });
    await sell(t.app, cashier, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CARD', amount: '10.00', reference: 'C1' }] });
    const ret = await request(t.app).post('/api/v1/returns').set(bearer(cashier)).set('Idempotency-Key', idemKey()).send({ originalReceiptId: a.body.receipt.id, lines: [{ lineNo: 1, quantity: '1' }], reason: 'Damaged box', refundMethod: 'CASH' });
    await request(t.app).post(`/api/v1/returns/${ret.body.return.id}/complete`).set(bearer(cashier)).send({ deviceId: String(s.deviceId) });

    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const d = await request(t.app).get(`/api/v1/reports/dashboard?from=${from}&to=${to}`).set(bearer(owner));
    expect(d.status).toBe(200);
    expect(d.body.sales).toMatchObject({ receiptCount: 2, grossSales: '110.00', totalIncludingTax: '124.00' });
    expect(d.body.returns).toMatchObject({ receiptCount: 1, totalIncludingTax: '57.00' });
    expect(d.body.netRevenueIncludingTax).toBe('67.00');
    expect(d.body.taxByType).toEqual([{ taxType: 'T1', netAmount: '7.00' }]);
    expect(d.body.eta.byStatus.NOT_SUBMITTED).toBe(3);
    expect(d.body.byBranch[0]).toMatchObject({ name: 'Main', sales: '124.00', returns: '57.00', net: '67.00' });

    const csv = await request(t.app).get(`/api/v1/reports/sales-by-product?from=${from}&to=${to}&format=csv`).set(bearer(owner));
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('SKU-1');

    const cashierDash = await request(t.app).get(`/api/v1/reports/dashboard?from=${from}&to=${to}`).set(bearer(cashier));
    expect(cashierDash.status).toBe(403);
  });
});

describe('product bulk import', () => {
  it('validates rows and reports row-level errors without importing on dry run', async () => {
    const s = await seedCompany();
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    const good = { kind: 'GOODS', internalCode: 'NEW-1', nameAr: 'جديد', description: 'New', etaItemType: 'EGS', etaItemCode: 'EG-1-9', unitType: 'EA', unitPrice: '5.00', taxCodes: ['VAT_STD'] };
    const rows = [good, { ...good, internalCode: 'SKU-1' }, { ...good, internalCode: 'NEW-2', taxCodes: ['NOPE'] }, { ...good, internalCode: 'NEW-3', unitPrice: '-1' }];
    const dry = await request(t.app).post('/api/v1/products/bulk').set(bearer(owner)).send({ dryRun: true, rows });
    expect(dry.body).toMatchObject({ totalRows: 4, validRows: 1, inserted: 0 });
    expect(dry.body.errors.map((e: { row: number }) => e.row)).toEqual([2, 3, 4]);
    const real = await request(t.app).post('/api/v1/products/bulk').set(bearer(owner)).send({ dryRun: false, rows: [good] });
    expect(real.body.inserted).toBe(1);
  });
});
