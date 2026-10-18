import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { bearer, idemKey, login, openShift, seedCompany, sell, useTestApp } from './helpers.js';

const t = useTestApp();
const range = () => `from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 3600_000).toISOString()}`;

describe('operational reports', () => {
  it('summarises tax per type/sub-type/rate net of returns and exports exact values to Excel', async () => {
    const s = await seedCompany({ submissionEnabled: false });
    const cashier = await login(t.app, s.users.CASHIER!.email);
    const shift = await openShift(t.app, cashier, s.deviceId);
    const sale = await sell(t.app, cashier, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.taxed), quantity: '2' }, { productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CASH', amount: '124.00' }] });
    const ret = await request(t.app).post('/api/v1/returns').set(bearer(cashier)).set('Idempotency-Key', idemKey()).send({ originalReceiptId: sale.body.receipt.id, lines: [{ lineNo: 1, quantity: '1' }], reason: 'Damaged box', refundMethod: 'CASH' });
    await request(t.app).post(`/api/v1/returns/${ret.body.return.id}/complete`).set(bearer(cashier)).send({ deviceId: String(s.deviceId) });
    await request(t.app).post(`/api/v1/pos/shifts/${shift.id}/close`).set(bearer(cashier)).send({ countedCash: '567.00' });

    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    const tax = await request(t.app).get(`/api/v1/reports/tax-summary?${range()}`).set(bearer(owner));
    expect(tax.body.items).toEqual([
      { taxType: 'T1', subType: 'V003', rate: '0', salesBase: '10.00', salesTax: '0.00', returnsBase: '0.00', returnsTax: '0.00', netBase: '10.00', netTax: '0.00' },
      { taxType: 'T1', subType: 'V009', rate: '14', salesBase: '100.00', salesTax: '14.00', returnsBase: '50.00', returnsTax: '7.00', netBase: '50.00', netTax: '7.00' },
    ]);
    const refunds = await request(t.app).get(`/api/v1/reports/refunds?${range()}`).set(bearer(owner));
    expect(refunds.body.items[0]).toMatchObject({ originalReceipt: sale.body.receipt.receiptNumber, refundAmount: '57.00', refundMethod: 'CASH', etaStatus: 'NOT_SUBMITTED' });
    const shifts = await request(t.app).get(`/api/v1/reports/shift-reconciliation?${range()}`).set(bearer(owner));
    expect(shifts.body.items[0]).toMatchObject({ expectedCash: '567.00', countedCash: '567.00', variance: '0.00' });
    const eta = await request(t.app).get(`/api/v1/reports/eta-processing?${range()}`).set(bearer(owner));
    expect(eta.body.items).toHaveLength(2);

    const xlsx = await request(t.app).get(`/api/v1/reports/tax-summary?${range()}&format=xlsx`).set(bearer(owner)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(1).text).toBe('taxType');
    expect(ws.getRow(3).getCell(5).text).toBe('14.00');
  });
});
