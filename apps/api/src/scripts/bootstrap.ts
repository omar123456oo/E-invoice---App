/**
 * Prepares a database for first use (e.g. MongoDB Atlas behind a Vercel deployment):
 *  1. Creates/updates every index (production does not auto-create indexes).
 *  2. Creates the first company and its owner account (password printed once).
 *  3. Optionally (BOOTSTRAP_DEMO=true) adds a DEMO branch, POS device, placeholder
 *     tax rules, products and a cashier so the application can be tried out.
 *
 *   MONGODB_URI="mongodb+srv://..." \
 *   BOOTSTRAP_LEGAL_NAME="My Company S.A.E." BOOTSTRAP_TRADE_NAME="My Store" \
 *   BOOTSTRAP_RIN="123456789" BOOTSTRAP_ACTIVITY_CODE="4711" \
 *   BOOTSTRAP_OWNER_EMAIL="owner@example.com" BOOTSTRAP_OWNER_NAME="Owner" \
 *   [BOOTSTRAP_DEMO=true] npm run bootstrap -w apps/api
 */
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { hashPassword } from '../modules/auth/password.js';
import { BranchModel } from '../modules/branches/branch.model.js';
import { PosDeviceModel } from '../modules/pos/pos-device.model.js';
import { ProductModel } from '../modules/products/product.model.js';
import { TaxConfigurationModel } from '../modules/tax/tax-configuration.model.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { UserModel } from '../modules/users/user.model.js';
// Imported so their indexes are synced too.
import '../modules/audit/audit-event.model.js';
import '../modules/auth/session.model.js';
import '../modules/customers/customer.model.js';
import '../modules/eta/eta-submission.model.js';
import '../modules/imports/import.model.js';
import '../modules/notifications/notification.model.js';
import '../modules/payments/payment.model.js';
import '../modules/pos/cashier-shift.model.js';
import '../modules/receipts/receipt.model.js';
import '../modules/returns/return.model.js';
import '../modules/sales/sales-transaction.model.js';

const need = (name: string): string => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const uri = need('MONGODB_URI');
await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
console.log(`Connected to database "${mongoose.connection.name}"`);

for (const m of Object.values(mongoose.models)) {
  await m.syncIndexes();
}
console.log(`Indexes synced for ${Object.keys(mongoose.models).length} collections`);

if (!process.env.BOOTSTRAP_RIN) {
  console.log('No BOOTSTRAP_RIN given: indexes only.');
  await mongoose.disconnect();
  process.exit(0);
}

const rin = need('BOOTSTRAP_RIN');
let tenant = await TenantModel.findOne({ taxRegistrationNumber: rin });
if (tenant) {
  console.log(`Company with RIN ${rin} already exists (${tenant.legalName}); not changed.`);
} else {
  tenant = await TenantModel.create({
    legalName: need('BOOTSTRAP_LEGAL_NAME'), tradeName: need('BOOTSTRAP_TRADE_NAME'), taxRegistrationNumber: rin,
    activityCode: need('BOOTSTRAP_ACTIVITY_CODE'), settings: { enabledPaymentMethods: ['CASH', 'CARD'] },
  });
  console.log(`Created company ${tenant.legalName}`);
}

const ownerEmail = need('BOOTSTRAP_OWNER_EMAIL').toLowerCase();
const generated = !process.env.BOOTSTRAP_OWNER_PASSWORD;
const password = process.env.BOOTSTRAP_OWNER_PASSWORD ?? randomBytes(12).toString('base64url');
if (password.length < 10) throw new Error('BOOTSTRAP_OWNER_PASSWORD must be at least 10 characters');
if (await UserModel.exists({ email: ownerEmail }).setOptions({ skipTenantGuard: true })) {
  console.log(`User ${ownerEmail} already exists; not changed.`);
} else {
  await UserModel.create({ tenantId: tenant._id, email: ownerEmail, name: process.env.BOOTSTRAP_OWNER_NAME ?? 'Owner', passwordHash: await hashPassword(password), role: 'COMPANY_OWNER' });
  console.log(`Created owner ${ownerEmail}${generated ? ` with password: ${password}  (shown once; change it after signing in)` : ''}`);
}

if (process.env.BOOTSTRAP_DEMO === 'true') {
  const t = tenant._id;
  if (await BranchModel.exists({ tenantId: t })) {
    console.log('Company already has branches; demo data not added.');
  } else {
    const branch = await BranchModel.create({ tenantId: t, name: 'DEMO Branch', etaBranchCode: '0', address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: 'Demo Street', buildingNumber: '1' } });
    await PosDeviceModel.create({ tenantId: t, branchId: branch._id, name: 'DEMO Till', code: 'T1', serialNumber: `DEMO-${rin}`, osVersion: 'os', modelFramework: '1', status: 'ACTIVE' });
    const owner = await UserModel.findOne({ email: ownerEmail }).setOptions({ skipTenantGuard: true }).lean();
    const verification = { source: 'DEMO PLACEHOLDER — replace with a verified rule before real use', verifiedBy: 'nobody (demo)', verifiedAt: new Date() };
    await TaxConfigurationModel.create([
      { tenantId: t, code: 'VAT_STD', version: 1, name: 'VAT standard (DEMO)', etaTaxType: 'T1', etaSubType: 'V009', treatment: 'PERCENTAGE', rate: '14', effectiveFrom: new Date('2020-01-01'), verification, createdBy: owner!._id },
      { tenantId: t, code: 'VAT_EXEMPT', version: 1, name: 'VAT exempt (DEMO)', etaTaxType: 'T1', etaSubType: 'V003', treatment: 'EXEMPT', rate: '0', effectiveFrom: new Date('2020-01-01'), verification, createdBy: owner!._id },
    ]);
    const p = { tenantId: t, kind: 'GOODS', etaItemType: 'EGS', unitType: 'EA' };
    await ProductModel.create([
      { ...p, internalCode: 'DEMO-001', barcode: '6220000000017', nameAr: 'مياه معدنية', nameEn: 'Mineral water', description: 'Mineral water 1.5L', etaItemCode: `EG-${rin}-001`, unitPrice: '10.00', taxCodes: ['VAT_STD'] },
      { ...p, internalCode: 'DEMO-002', barcode: '6220000000024', nameAr: 'خبز', nameEn: 'Bread', description: 'Bread loaf', etaItemCode: `EG-${rin}-002`, unitPrice: '5.00', taxCodes: ['VAT_EXEMPT'] },
      { ...p, internalCode: 'DEMO-003', barcode: '6220000000031', nameAr: 'قهوة', nameEn: 'Coffee', description: 'Ground coffee 250g', etaItemCode: `EG-${rin}-003`, unitPrice: '120.00', taxCodes: ['VAT_STD'] },
    ]);
    const cashierEmail = ownerEmail.replace(/^[^@]+/, (u) => `${u}+cashier`);
    const cashierPassword = randomBytes(12).toString('base64url');
    await UserModel.create({ tenantId: t, email: cashierEmail, name: 'Demo Cashier', passwordHash: await hashPassword(cashierPassword), role: 'CASHIER', branchIds: [branch._id] });
    console.log(`Added DEMO branch, device, placeholder tax rules and products. Cashier: ${cashierEmail} / ${cashierPassword}`);
  }
}
await mongoose.disconnect();
