import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { processImportJob, setImportDeps } from '../src/modules/imports/import.service.js';
import { LocalFileStorage } from '../src/modules/imports/storage.js';
import { ProductModel } from '../src/modules/products/product.model.js';
import { bearer, login, seedCompany, useTestApp } from './helpers.js';

const t = useTestApp();
beforeAll(() => setImportDeps({ storage: new LocalFileStorage(mkdtempSync(join(tmpdir(), 'uploads-'))) }));

const HEADER = 'kind,internalCode,barcode,nameAr,nameEn,description,etaItemType,etaItemCode,unitType,unitPrice,taxCodes';
const csv = (...rows: string[]) => Buffer.from(['﻿' + HEADER, ...rows].join('\r\n'), 'utf8');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');

async function upload(token: string, purpose: string, data: Buffer, name: string) {
  return request(t.app).post('/api/v1/imports/uploads').set(bearer(token)).field('purpose', purpose).attach('file', data, name);
}

describe('import centre', () => {
  it('previews a CSV product import with row-level errors and imports only valid rows on confirmation', async () => {
    const s = await seedCompany();
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    const file = csv(
      'GOODS,IMP-1,00123456,شاي,Tea,Tea 100g,EGS,EG-1-100,EA,25.50,VAT_STD',
      'GOODS,IMP-2,,قهوة,,Coffee,EGS,EG-1-101,EA,-4,VAT_STD',
      'SERVICE,IMP-3,,خدمة,Service,Repair,EGS,EG-1-102,EA,100,NOPE',
      'GOODS,SKU-1,,مكرر,,Existing,EGS,EG-1-103,EA,1,VAT_STD',
      'GOODS,IMP-5,,سعر,,Bad price,EGS,EG-1-104,EA,abc,VAT_STD',
    );
    const up = await upload(owner, 'PRODUCT_IMPORT', file, 'products.csv');
    expect(up.status).toBe(201);
    expect(up.body.upload).toMatchObject({ kind: 'csv', scan: { status: 'NOT_SCANNED' } });
    expect(await processImportJob(s.tenantId, new Types.ObjectId(up.body.job.id))).toBe('READY');

    const job = await request(t.app).get(`/api/v1/imports/${up.body.job.id}`).set(bearer(owner));
    expect(job.body.counts).toMatchObject({ total: 5, valid: 1, invalid: 4 });
    const bad = await request(t.app).get(`/api/v1/imports/${up.body.job.id}/rows?invalidOnly=true`).set(bearer(owner));
    expect(bad.body.items.map((r: { rowNo: number }) => r.rowNo)).toEqual([2, 3, 4, 5]);
    expect(JSON.stringify(bad.body.items[3].issues)).toContain('unitPrice');
    expect(JSON.stringify(bad.body.items[1].issues)).toContain('Unknown tax codes');

    const strict = await request(t.app).post(`/api/v1/imports/${up.body.job.id}/commit`).set(bearer(owner)).send({});
    expect(strict.body.error.code).toBe('IMPORT_HAS_ERRORS');
    const partial = await request(t.app).post(`/api/v1/imports/${up.body.job.id}/commit`).set(bearer(owner)).send({ allowPartial: true });
    expect(partial.body).toMatchObject({ status: 'COMMITTED', counts: { inserted: 1 } });
    const tea = await ProductModel.findOne({ tenantId: s.tenantId, internalCode: 'IMP-1' }).lean();
    expect(tea).toMatchObject({ barcode: '00123456', nameAr: 'شاي' });
    expect(tea!.unitPrice.toString()).toBe('25.50');
  });

  it('reads Excel workbooks keeping displayed text', async () => {
    const s = await seedCompany();
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(HEADER.split(','));
    ws.addRow(['GOODS', 'XL-1', '0099', 'سكر', 'Sugar', 'Sugar 1kg', 'EGS', 'EG-1-200', 'KGM', '32.00', 'VAT_STD;']);
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await upload(owner, 'PRODUCT_IMPORT', data, 'products.xlsx');
    expect(up.body.upload.kind).toBe('xlsx');
    await processImportJob(s.tenantId, new Types.ObjectId(up.body.job.id));
    const rows = await request(t.app).get(`/api/v1/imports/${up.body.job.id}/rows`).set(bearer(owner));
    expect(rows.body.items[0]).toMatchObject({ valid: true, data: { barcode: '0099', unitPrice: '32.00', taxCodes: ['VAT_STD'] } });
  });

  it('detects duplicates, checks content not names, and enforces permissions', async () => {
    const s = await seedCompany();
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    const file = csv('GOODS,D-1,,ا,,x,EGS,EG-1-1,EA,1,VAT_STD');
    const a = await upload(owner, 'PRODUCT_IMPORT', file, 'a.csv');
    const b = await upload(owner, 'PRODUCT_IMPORT', file, 'renamed.csv');
    expect(b.body.duplicate).toBe(true);
    expect(b.body.upload.id).toBe(a.body.upload.id);
    const binary = await upload(owner, 'PRODUCT_IMPORT', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), 'evil.csv');
    expect(binary.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const pdfAsProducts = await upload(owner, 'PRODUCT_IMPORT', PDF, 'products.csv');
    expect(pdfAsProducts.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    const cashier = await login(t.app, s.users.CASHIER!.email);
    expect((await upload(cashier, 'PRODUCT_IMPORT', file, 'a.csv')).status).toBe(403);
  });

  it('blocks files the malware scanner flags', async () => {
    const s = await seedCompany();
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    setImportDeps({ scanner: { scan: async () => ({ status: 'INFECTED', detail: 'Eicar-Test-Signature' }) } });
    try {
      const r = await upload(owner, 'SUPPLIER_INVOICE', PDF, 'invoice.pdf');
      expect(r.body.error.code).toBe('MALWARE_DETECTED');
    } finally {
      setImportDeps({ scanner: { scan: async () => ({ status: 'NOT_SCANNED', detail: null }) } });
    }
  });

  it('requires human review of documents, recalculates totals and never creates receipts', async () => {
    const s = await seedCompany();
    const accountant = await login(t.app, s.users.ACCOUNTANT!.email);
    const up = await upload(accountant, 'SUPPLIER_INVOICE', PDF, 'invoice.pdf');
    expect(up.status).toBe(201);
    expect(await processImportJob(s.tenantId, new Types.ObjectId(up.body.job.id))).toBe('NEEDS_REVIEW');
    const review = {
      documentNumber: 'INV-77', issueDate: '2026-10-01', sellerName: 'Supplier Co', currency: 'EGP',
      lines: [{ description: 'Cups', quantity: '10', unitPrice: '2.50', taxAmount: '3.50' }],
      statedTotals: { net: '25.00', tax: '3.50', total: '29.00' },
    };
    const mismatch = await request(t.app).post(`/api/v1/imports/${up.body.job.id}/review`).set(bearer(accountant)).send(review);
    expect(mismatch.body.error.code).toBe('TOTALS_MISMATCH');
    expect(mismatch.body.error.details[0].message).toContain('computed 28.50');
    const ok = await request(t.app).post(`/api/v1/imports/${up.body.job.id}/review`).set(bearer(accountant)).send({ ...review, statedTotals: { ...review.statedTotals, total: '28.50' } });
    expect(ok.body).toMatchObject({ status: 'REVIEWED', review: { computed: { total: '28.50' }, differences: [] } });
    const receipts = await request(t.app).get('/api/v1/receipts').set(bearer(await login(t.app, s.users.COMPANY_OWNER!.email)));
    expect(receipts.body.total).toBe(0);
    const file = await request(t.app).get(`/api/v1/imports/uploads/${up.body.upload.id}/file`).set(bearer(accountant));
    expect(file.headers['content-disposition']).toContain('attachment');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });
});
