/**
 * Development seed for every module. Run after seed:dev, with the API running:
 *
 *   npm run seed:activity -w apps/api        (API_URL defaults to http://localhost:3000/api/v1)
 *
 * Everything except the extra user accounts goes through the HTTP API, so sales,
 * receipts, ETA states, returns, notifications and the audit trail are produced by
 * the real business rules rather than written straight into the database.
 * ETA submissions go to the SIMULATED transport only; refuses to run otherwise
 * or when NODE_ENV=production.
 */
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectMongo } from '../common/db/mongo.js';
import { hashPassword } from '../modules/auth/password.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { UserModel } from '../modules/users/user.model.js';

const cfg = env();
if (cfg.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
if (cfg.ETA_TRANSPORT !== 'simulated') throw new Error('Refusing to seed: ETA_TRANSPORT must be "simulated" so no receipt reaches the Egyptian Tax Authority');
const API = process.env.API_URL ?? `http://localhost:${cfg.PORT ?? 3000}/api/v1`;
const password = process.env.SEED_PASSWORD ?? 'ChangeMe-Dev-Only-123';

type Json = Record<string, any>;
const key = () => randomUUID();

async function call(token: string | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<any> {
  const headers: Record<string, string> = { 'X-Requested-With': 'seed', ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: RequestInit['body'];
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + path, { method, headers, body: payload });
  const text = await res.text();
  const data = text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
const login = async (email: string) => (await call(null, 'POST', '/auth/login', { email, password })).accessToken as string;
const items = (r: any): any[] => (Array.isArray(r) ? r : (r.items ?? r.data ?? []));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- accounts
await connectMongo(cfg.MONGODB_URI);
const tenant = await TenantModel.findOne({ taxRegistrationNumber: '000000000' }).lean();
if (!tenant) throw new Error('Demo company not found: run npm run seed:dev -w apps/api first');
const { SalesTransactionModel } = await import('../modules/sales/sales-transaction.model.js');
const cashier2User = await UserModel.findOne({ email: 'cashier2@demo.local' }).setOptions({ skipTenantGuard: true }).lean();
if (cashier2User && (await SalesTransactionModel.exists({ tenantId: tenant._id, cashierId: cashier2User._id }))) {
  console.log('Activity data already seeded; nothing to do.');
  await mongoose.disconnect();
  process.exit(0);
}

const owner = await login('owner@demo.local');
console.log(`Seeding all modules through ${API}`);

// ---------------------------------------------------------------- company, branches, devices
await call(owner, 'PATCH', '/company', {
  commercialRegistrationNumber: 'DEMO-CR-0001',
  contact: { email: 'accounts@demo.local', phone: '+20221234567' },
  settings: { enabledPaymentMethods: ['CASH', 'CARD', 'WALLET', 'BANK_TRANSFER'], returnApprovalAmount: '200', emailAlerts: false },
});
const id = (x: Json) => (x._id ?? x.id) as string;
const branches = items(await call(owner, 'GET', '/branches'));
const ensureBranch = async (body: Json) => branches.find((b) => b.etaBranchCode === body.etaBranchCode) ?? call(owner, 'POST', '/branches', body);
const branch1 = branches.find((b) => b.etaBranchCode === '0')!;
const branch2 = await ensureBranch({
  name: 'DEMO Alexandria Branch', etaBranchCode: '1', phone: '+2031234567',
  address: { country: 'EG', governate: 'Alexandria', regionCity: 'Smouha', street: 'Demo Corniche', buildingNumber: '22', floor: '1' },
});
await ensureBranch({
  name: 'DEMO Giza Branch (closed)', etaBranchCode: '2', isActive: false,
  address: { country: 'EG', governate: 'Giza', regionCity: 'Dokki', street: 'Demo Street', buildingNumber: '5' },
});
const devices = items(await call(owner, 'GET', '/pos-devices'));
const ensureDevice = async (body: Json) => devices.find((d) => d.code === body.code) ?? call(owner, 'POST', '/pos-devices', body);
const till1 = devices.find((d) => d.code === 'T1')!;
const till2 = await ensureDevice({ branchId: branch2._id ?? branch2.id, name: 'DEMO Alex Till', code: 'T2', serialNumber: 'DEMO-SERIAL-2', osVersion: 'os', modelFramework: '1' });
const till3 = await ensureDevice({ branchId: branch1._id ?? branch1.id, name: 'DEMO Spare Till', code: 'T3', serialNumber: 'DEMO-SERIAL-3', osVersion: 'os', modelFramework: '1' });
if (till3.status !== 'ACTIVE') await call(owner, 'PATCH', `/pos-devices/${id(till3)}/status`, { status: 'ACTIVE' }).catch(() => undefined);
for (const t of [till1, till2, till3]) {
  if (t.status !== 'ACTIVE') await call(owner, 'PATCH', `/pos-devices/${id(t)}/status`, { status: 'ACTIVE' });
  // Fake credentials: only the SIMULATED transport ever sees them.
  await call(owner, 'PUT', `/pos-devices/${id(t)}/eta-credentials`, { clientId: `demo-client-${t.code}`, clientSecret: `demo-secret-${t.code}` });
}
await call(owner, 'PATCH', '/company', { eta: { onboardingStatus: 'PREPROD_TESTING', b2cTagConfirmed: true, submissionEnabled: true, notes: 'DEMO: submissions go to the SIMULATED ETA only' } });
console.log('  ✓ company settings, 3 branches, 3 tills, ETA (simulated) enabled');

// ---------------------------------------------------------------- users (direct: the API requires 10+ character passwords)
const passwordHash = await hashPassword(password);
const t = tenant._id;
const extraUsers = [
  { tenantId: t, email: 'admin@demo.local', name: 'Demo Company Admin', passwordHash, role: 'COMPANY_ADMIN' },
  { tenantId: t, email: 'cashier2@demo.local', name: 'Demo Alex Cashier', passwordHash, role: 'CASHIER', branchIds: [id(branch2)] },
  { tenantId: t, email: 'accountant@demo.local', name: 'Demo Accountant', passwordHash, role: 'ACCOUNTANT' },
  { tenantId: t, email: 'auditor@demo.local', name: 'Demo Auditor', passwordHash, role: 'AUDITOR', locale: 'en' },
  { tenantId: t, email: 'support@demo.local', name: 'Demo Tech Support', passwordHash, role: 'TECH_SUPPORT', locale: 'en' },
];
for (const u of extraUsers) {
  if (!(await UserModel.exists({ email: u.email }).setOptions({ skipTenantGuard: true }))) await UserModel.create(u);
}
await mongoose.disconnect();
console.log('  ✓ 5 more users (admin, cashier2, accountant, auditor, support)');

// ---------------------------------------------------------------- products
const p = { kind: 'GOODS', etaItemType: 'EGS', unitType: 'EA' };
const newProducts = [
  { ...p, internalCode: 'DEMO-004', barcode: '6220000000048', nameAr: 'شاي', nameEn: 'Tea', description: 'Black tea 100 bags', etaItemCode: 'EG-000000000-004', unitPrice: '65.00', taxCodes: ['VAT_STD'] },
  { ...p, internalCode: 'DEMO-005', barcode: '6220000000055', nameAr: 'سكر', nameEn: 'Sugar', description: 'White sugar 1kg', etaItemCode: 'EG-000000000-005', unitPrice: '35.00', taxCodes: ['VAT_EXEMPT'] },
  { ...p, internalCode: 'DEMO-006', barcode: '6220000000062', nameAr: 'أرز', nameEn: 'Rice', description: 'Egyptian rice 1kg', etaItemCode: 'EG-000000000-006', unitPrice: '40.00', taxCodes: ['VAT_EXEMPT'] },
  { ...p, internalCode: 'DEMO-007', barcode: '6220000000079', nameAr: 'زيت', nameEn: 'Cooking oil', description: 'Sunflower oil 1L', etaItemCode: 'EG-000000000-007', unitPrice: '85.50', taxCodes: ['VAT_STD'] },
  { ...p, internalCode: 'DEMO-008', barcode: '6220000000086', nameAr: 'جبنة', nameEn: 'Cheese', description: 'White cheese 500g', etaItemCode: 'EG-000000000-008', unitPrice: '72.25', taxCodes: ['VAT_STD'] },
  { ...p, internalCode: 'DEMO-009', barcode: '6220000000093', nameAr: 'شوكولاتة', nameEn: 'Chocolate', description: 'Milk chocolate bar', etaItemCode: 'EG-000000000-009', unitPrice: '25.00', taxCodes: ['VAT_STD'] },
  { ...p, internalCode: 'DEMO-010', barcode: '6220000000109', nameAr: 'منظف', nameEn: 'Detergent', description: 'Washing powder 2kg', etaItemCode: 'EG-000000000-010', unitPrice: '150.00', taxCodes: ['VAT_STD'] },
  { ...p, kind: 'SERVICE', internalCode: 'DEMO-SVC-1', barcode: null, nameAr: 'توصيل', nameEn: 'Home delivery', description: 'Home delivery service', etaItemCode: 'EG-000000000-S01', unitPrice: '30.00', taxCodes: ['VAT_STD'] },
  { ...p, internalCode: 'DEMO-OLD', barcode: '6220000000116', nameAr: 'منتج متوقف', nameEn: 'Discontinued item', description: 'No longer sold', etaItemCode: 'EG-000000000-099', unitPrice: '9.99', taxCodes: ['VAT_STD'], isActive: false },
];
const existingCodes = new Set(items(await call(owner, 'GET', '/products?pageSize=100')).map((x) => x.internalCode));
for (const prod of newProducts) if (!existingCodes.has(prod.internalCode)) await call(owner, 'POST', '/products', prod);
console.log(`  ✓ ${newProducts.length} more products`);

// ---------------------------------------------------------------- import centre
const template = await call(owner, 'GET', '/imports/templates/products.csv');
const header = String(template).replace(/^\uFEFF/, '').split(/\r?\n/)[0]!;
const cols = header.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
const row = (v: Json) => cols.map((c) => String(v[c] ?? '')).join(',');
const csvRows = [
  { kind: 'GOODS', internalCode: 'DEMO-IMP-1', barcode: '0062200000123', nameAr: 'مكرونة', nameEn: 'Pasta', description: 'Pasta 400g', etaItemType: 'EGS', etaItemCode: 'EG-000000000-101', unitType: 'EA', unitPrice: '18.00', taxCodes: 'VAT_EXEMPT' },
  { kind: 'GOODS', internalCode: 'DEMO-IMP-2', barcode: '0062200000130', nameAr: 'عصير', nameEn: 'Juice', description: 'Orange juice 1L', etaItemType: 'EGS', etaItemCode: 'EG-000000000-102', unitType: 'EA', unitPrice: '45.00', taxCodes: 'VAT_STD' },
  { kind: 'GOODS', internalCode: 'DEMO-IMP-3', barcode: '0062200000147', nameAr: 'بسكويت', nameEn: 'Biscuits', description: 'Biscuits pack', etaItemType: 'EGS', etaItemCode: 'EG-000000000-103', unitType: 'EA', unitPrice: '12.50', taxCodes: 'VAT_STD' },
  { kind: 'GOODS', internalCode: 'DEMO-IMP-BAD', barcode: '', nameAr: '', nameEn: 'Broken row', description: 'Missing Arabic name and bad price', etaItemType: 'EGS', etaItemCode: 'EG-000000000-104', unitType: 'EA', unitPrice: 'abc', taxCodes: 'VAT_STD' },
];
async function upload(name: string, type: string, content: string | Uint8Array, purpose: string) {
  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', new Blob([content], { type }), name);
  return call(owner, 'POST', '/imports/uploads', form);
}
async function waitImport(jobId: string): Promise<Json> {
  for (let i = 0; i < 60; i++) {
    const job = await call(owner, 'GET', `/imports/${jobId}`);
    if (!['PENDING', 'PROCESSING'].includes(job.status)) return job;
    await call(owner, 'POST', '/eta/process', {}).catch(() => undefined);
    await sleep(500);
  }
  throw new Error(`import ${jobId} did not finish`);
}
const jobIdOf = (r: Json) => (r.job?._id ?? r.job?.id ?? r.jobId ?? r._id ?? r.id) as string;
const previousCsv = items(await call(owner, 'GET', '/imports')).find((j) => j.purpose === 'PRODUCT_IMPORT');
if (previousCsv?.status === 'FAILED') await call(owner, 'POST', `/imports/${id(previousCsv)}/retry`, {});
const csvJob = previousCsv ? await waitImport(id(previousCsv)) : await waitImport(jobIdOf(await upload('demo-products.csv', 'text/csv', [header, ...csvRows.map(row)].join('\r\n') + '\r\n', 'PRODUCT_IMPORT')));
if (csvJob.status === 'READY') await call(owner, 'POST', `/imports/${id(csvJob)}/commit`, { allowPartial: true });
const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
const seededDocs = items(await call(owner, 'GET', '/imports')).some((j) => j.purpose === 'SUPPLIER_INVOICE');
const invoiceJob: Json = seededDocs ? { status: 'SKIPPED' } : await waitImport(jobIdOf(await upload('demo-supplier-invoice.pdf', 'application/pdf', pdf, 'SUPPLIER_INVOICE')));
if (invoiceJob.status === 'NEEDS_REVIEW') {
  await call(owner, 'POST', `/imports/${id(invoiceJob)}/review`, {
    documentNumber: 'DEMO-INV-7781', issueDate: new Date().toISOString().slice(0, 10), sellerName: 'DEMO Wholesale Supplier', sellerTaxId: '000000001', currency: 'EGP',
    lines: [{ description: 'Mineral water carton', quantity: '20', unitPrice: '80.00', taxAmount: '224.00' }, { description: 'Coffee carton', quantity: '5', unitPrice: '900.00', taxAmount: '630.00' }],
    statedTotals: { net: '6100.00', tax: '854.00', total: '6954.00' }, notes: 'DEMO document',
  });
}
const rejectJob: Json = seededDocs ? { status: 'SKIPPED' } : await waitImport(jobIdOf(await upload('demo-external.pdf', 'application/pdf', pdf, 'EXTERNAL_DOCUMENT')));
if (['READY', 'NEEDS_REVIEW', 'FAILED'].includes(rejectJob.status)) await call(owner, 'POST', `/imports/${id(rejectJob)}/reject`, { reason: 'DEMO: unreadable scan' });
console.log(`  ✓ imports: product CSV (${csvJob.status} → committed), supplier invoice reviewed, one document rejected`);

// ---------------------------------------------------------------- customers
const existingCustomers = items(await call(owner, 'GET', '/customers?pageSize=100'));
const customers: Json[] = [];
for (const c of [
  { buyerType: 'P', name: 'أحمد محمود (DEMO)', identity: '29001011234567', mobileNumber: '01000000001', email: 'ahmed@demo.local', marketingConsent: true },
  { buyerType: 'P', name: 'Sara Ali (DEMO)', identity: '29502021234568', mobileNumber: '01100000002', marketingConsent: false },
  { buyerType: 'B', name: 'DEMO Trading LLC', identity: '000000002', mobileNumber: '0223456789', email: 'buyer@demo.local', notes: 'Business customer' },
  { buyerType: 'F', name: 'John Smith (DEMO)', identity: 'DEMO-PASSPORT-1', notes: 'Foreign customer' },
  { buyerType: 'P', name: 'Old Customer (DEMO)', identity: '28003031234569', mobileNumber: '01200000003' },
]) customers.push(existingCustomers.find((x) => x.name === c.name) ?? (await call(owner, 'POST', '/customers', c)).customer);
if (!customers[4]!.anonymizedAt) await call(owner, 'POST', `/customers/${id(customers[4]!)}/anonymize`, {}).catch((e) => console.warn(`  ! anonymize: ${e.message}`));
console.log(`  ✓ ${customers.length} customers (one anonymised)`);

// ---------------------------------------------------------------- shifts and sales
const catalogue = items(await call(owner, 'GET', '/products?pageSize=100')).filter((x) => x.isActive !== false);
const byCode = (code: string) => {
  const found = catalogue.find((x) => x.internalCode === code);
  if (!found) throw new Error(`product ${code} missing`);
  return id(found);
};
const cashier1 = await login('cashier@demo.local');
const cashier2 = await login('cashier2@demo.local');
async function openShift(token: string, deviceId: string, openingCash: string) {
  const { shift } = await call(token, 'GET', '/pos/shifts/current');
  if (shift) return shift;
  return call(token, 'POST', '/pos/shifts', { deviceId, openingCash });
}
// T1 is left alone: it may already have a shift opened by someone else.
const shift1 = await openShift(cashier1, id(till3), '500.00');
const shift2 = await openShift(cashier2, id(till2), '300.00');

type Line = [code: string, qty: string, discount?: Json];
async function sell(token: string, deviceId: string, lines: Line[], pay: (total: string) => Json[], extra: Json = {}) {
  const body = { deviceId, items: lines.map(([code, quantity, discount]) => ({ productId: byCode(code), quantity, ...(discount ? { discount } : {}) })), ...extra };
  const quote = await call(token, 'POST', '/pos/quote', body);
  const total = String(quote.totalAmount ?? quote.totals?.totalAmount ?? quote.total);
  return call(token, 'POST', '/pos/checkout', { ...body, payments: pay(total) }, { 'Idempotency-Key': key() });
}
const cash = (total: string) => [{ method: 'CASH', amount: total, tendered: String(Math.ceil(Number(total) / 50) * 50) }];
const card = (ref: string) => (total: string) => [{ method: 'CARD', amount: total, reference: ref }];
const wallet = (ref: string) => (total: string) => [{ method: 'WALLET', amount: total, reference: ref }];
const split = (total: string) => {
  const half = (Math.round(Number(total) * 50) / 100).toFixed(2);
  return [{ method: 'CASH', amount: half, tendered: half }, { method: 'CARD', amount: (Number(total) - Number(half)).toFixed(2), reference: 'DEMO-AUTH-SPLIT' }];
};

const sales: Json[] = [];
sales.push(await sell(cashier1, id(till3), [['DEMO-001', '2'], ['DEMO-003', '1']], cash));
sales.push(await sell(cashier1, id(till3), [['DEMO-002', '6'], ['DEMO-005', '2'], ['DEMO-006', '1']], cash));
sales.push(await sell(cashier1, id(till3), [['DEMO-010', '2'], ['DEMO-007', '1']], card('DEMO-AUTH-1001')));
sales.push(await sell(cashier1, id(till3), [['DEMO-004', '1'], ['DEMO-009', '4']], wallet('DEMO-WALLET-1')));
sales.push(await sell(cashier1, id(till3), [['DEMO-008', '2'], ['DEMO-003', '2']], split, { customerId: id(customers[0]!) }));
sales.push(await sell(cashier1, id(till3), [['DEMO-003', '3', { rate: '5', description: 'DEMO promo 5%' }], ['DEMO-SVC-1', '1']], cash, { customerId: id(customers[2]!) }));
sales.push(await sell(cashier1, id(till3), [['DEMO-IMP-2', '2'], ['DEMO-IMP-3', '3'], ['DEMO-IMP-1', '4']], cash));
sales.push(await sell(cashier1, id(till3), [['DEMO-001', '12']], card('DEMO-AUTH-1002'), { extraDiscount: { amount: '5.00', description: 'DEMO loyalty' } }));
sales.push(await sell(cashier2, id(till2), [['DEMO-007', '2'], ['DEMO-006', '3']], cash));
sales.push(await sell(cashier2, id(till2), [['DEMO-009', '10']], cash, { buyer: { type: 'P', name: 'Walk-in (DEMO)', mobileNumber: '01500000009' } }));
sales.push(await sell(cashier2, id(till2), [['DEMO-010', '1'], ['DEMO-004', '2']], card('DEMO-AUTH-2001'), { customerId: id(customers[3]!) }));
sales.push(await sell(cashier2, id(till2), [['DEMO-002', '10'], ['DEMO-001', '6']], wallet('DEMO-WALLET-2'), { customerId: id(customers[1]!) }));
console.log(`  ✓ 2 shifts opened, ${sales.length} sales (cash, card, wallet, split, discounts, customers)`);

// ---------------------------------------------------------------- ETA (simulated): submit, then poll to a final status
// The sweeper polls a submission 15 s after it was accepted; keep processing until nothing is in flight.
const etaStatus = (r: Json) => (r.eta?.status ?? r.etaStatus) as string;
async function settleEta(): Promise<Json[]> {
  for (let i = 0; i < 20; i++) {
    await call(owner, 'POST', '/eta/process', {});
    const all = items(await call(owner, 'GET', '/receipts?pageSize=100'));
    if (!all.some((r) => ['NOT_SUBMITTED', 'QUEUED', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN'].includes(etaStatus(r)))) return all;
    await sleep(4000);
  }
  return items(await call(owner, 'GET', '/receipts?pageSize=100'));
}
console.log('  … waiting for SIMULATED ETA validation (about 20 s)');
await settleEta();
const receipts = items(await call(owner, 'GET', '/receipts?pageSize=100'));
const statuses = receipts.reduce<Record<string, number>>((m, r) => ((m[etaStatus(r)] = (m[etaStatus(r)] ?? 0) + 1), m), {});
console.log(`  ✓ ETA (SIMULATED) processing: ${JSON.stringify(statuses)}`);

// Print / reprint a receipt.
const inCairo = (r: Json) => String(r.branchId) === id(branch1);
const firstReceipt = receipts.find(inCairo)!;
await call(cashier1, 'POST', `/receipts/${id(firstReceipt)}/print`, {}).catch((e) => console.warn(`  ! print: ${e.message}`));
await call(cashier1, 'POST', `/receipts/${id(firstReceipt)}/print`, {}).catch(() => undefined);

// Corrections are not seeded: only REJECTED, INVALID or FAILED receipts can be corrected,
// and the SIMULATED ETA validates every receipt.

// ---------------------------------------------------------------- returns
const after = items(await call(owner, 'GET', '/receipts?pageSize=100'));
const returnable = after.filter((r) => inCairo(r) && etaStatus(r) === 'VALID' && (r.type ?? r.receiptType ?? 's') !== 'r' && !r.referenceOldUUID);
async function requestReturn(token: string, receipt: Json, lines: Json[], reason: string, refundMethod: string, refundReference?: string) {
  return (await call(token, 'POST', '/returns', { originalReceiptId: id(receipt), lines, reason, refundMethod, ...(refundReference ? { refundReference } : {}) }, { 'Idempotency-Key': key() })).return;
}
let returnsDone = 0;
let returnsRejected = 0;
let returnsPending = 0;
try {
  const small = returnable.find((r) => Number(r.totalAmount ?? r.totals?.totalAmount ?? 0) < 200) ?? returnable[0];
  const r1 = await requestReturn(cashier1, small, [{ lineNo: 1, quantity: '1' }], 'DEMO: damaged packaging', 'CASH');
  if (r1.status === 'PENDING_APPROVAL') await call(owner, 'POST', `/returns/${id(r1)}/decision`, { approve: true, notes: 'DEMO approved' });
  await call(cashier1, 'POST', `/returns/${id(r1)}/complete`, { deviceId: id(till3) });
  returnsDone++;
  const big = returnable.find((r) => r !== small && Number(r.totalAmount ?? r.totals?.totalAmount ?? 0) >= 200);
  if (big) {
    const r2 = await requestReturn(cashier1, big, [{ lineNo: 1, quantity: '1' }], 'DEMO: customer changed mind', 'CARD', 'DEMO-REFUND-1');
    if (r2.status === 'PENDING_APPROVAL') await call(owner, 'POST', `/returns/${id(r2)}/decision`, { approve: true, notes: 'DEMO approved by owner' });
    await call(cashier1, 'POST', `/returns/${id(r2)}/complete`, { deviceId: id(till3) });
    returnsDone++;
    const r3 = await requestReturn(cashier1, big, [{ lineNo: 2, quantity: '1' }], 'DEMO: no proof of purchase', 'CASH').catch((e) => (console.warn(`  ! return request: ${e.message}`), null));
    if (r3?.status === 'PENDING_APPROVAL') {
      await call(owner, 'POST', `/returns/${id(r3)}/decision`, { approve: false, notes: 'DEMO rejected' });
      returnsRejected++;
    }
    const other = returnable.find((r) => r !== small && r !== big);
    const r4 = other ? await requestReturn(cashier1, other, [{ lineNo: 1, quantity: '1' }], 'DEMO: awaiting manager', 'CASH').catch((e) => (console.warn(`  ! return request: ${e.message}`), null)) : null;
    if (r4?.status === 'PENDING_APPROVAL') returnsPending++;
  }
} catch (e) {
  console.warn(`  ! returns: ${(e as Error).message}`);
}
const final = await settleEta();
console.log(`  ✓ returns: ${returnsDone} completed, ${returnsRejected} rejected, ${returnsPending} awaiting approval`);
const finalStatuses = final.reduce<Record<string, number>>((m, r) => ((m[etaStatus(r)] = (m[etaStatus(r)] ?? 0) + 1), m), {});
console.log(`  ✓ receipts after returns/corrections: ${JSON.stringify(finalStatuses)}`);

// ---------------------------------------------------------------- close one shift (with a small cash difference)
await call(cashier2, 'POST', `/pos/shifts/${id(shift2)}/close`, { countedCash: '1000.00', notes: 'DEMO end of day count' })
  .then(() => console.log('  ✓ Alexandria shift closed; Cairo shift left open'), (e) => console.warn(`  ! close shift: ${e.message}`));
void shift1;

// ---------------------------------------------------------------- notifications and audit check
const unread = await call(owner, 'GET', '/notifications/unread-count').catch(() => null);
const audit = await call(owner, 'GET', '/audit-events/verify').catch(() => null);
console.log(`  ✓ notifications unread: ${JSON.stringify(unread)}; audit chain: ${JSON.stringify(audit)}`);
console.log(`Done. All demo users use the password ${process.env.SEED_PASSWORD ? 'from SEED_PASSWORD' : password}.`);
