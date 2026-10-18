/**
 * Development seed. Creates a platform admin and one demo company with DEMO data.
 * Refuses to run when NODE_ENV=production. Demo tax rates are placeholders that
 * must be replaced by rules verified with a qualified Egyptian tax professional.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectMongo } from '../common/db/mongo.js';
import { hashPassword } from '../modules/auth/password.js';
import { BranchModel } from '../modules/branches/branch.model.js';
import { PosDeviceModel } from '../modules/pos/pos-device.model.js';
import { ProductModel } from '../modules/products/product.model.js';
import { TaxConfigurationModel } from '../modules/tax/tax-configuration.model.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { UserModel } from '../modules/users/user.model.js';

const cfg = env();
if (cfg.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
const password = process.env.SEED_PASSWORD ?? 'ChangeMe-Dev-Only-123';

await connectMongo(cfg.MONGODB_URI);
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

const alreadySeeded = await TenantModel.exists({ taxRegistrationNumber: '000000000' });
if (alreadySeeded) console.log('Demo company already exists; nothing to do.');
else await seed();
if (process.argv[1]?.endsWith('seed-dev.ts') || process.argv[1]?.endsWith('seed-dev.js')) await mongoose.disconnect();

async function seed(): Promise<void> {
const passwordHash = await hashPassword(password);
await UserModel.create({ tenantId: null, email: 'platform@demo.local', name: 'Platform Admin', passwordHash, role: 'PLATFORM_ADMIN' });
const tenant = await TenantModel.create({
  legalName: 'DEMO Retail Co. (not a real taxpayer)', tradeName: 'DEMO Store', taxRegistrationNumber: '000000000', activityCode: '4711',
  settings: { enabledPaymentMethods: ['CASH', 'CARD', 'WALLET'] },
  eta: { onboardingStatus: 'NOT_STARTED', b2cTagConfirmed: false, submissionEnabled: false, notes: 'Demo data' },
});
const branch = await BranchModel.create({
  tenantId: tenant._id, name: 'DEMO Branch', etaBranchCode: '0',
  address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: 'Demo Street', buildingNumber: '1' },
});
await PosDeviceModel.create({ tenantId: tenant._id, branchId: branch._id, name: 'DEMO Till', code: 'T1', serialNumber: 'DEMO-SERIAL-1', osVersion: 'os', modelFramework: '1', status: 'ACTIVE' });
const owner = await UserModel.create({ tenantId: tenant._id, email: 'owner@demo.local', name: 'Demo Owner', passwordHash, role: 'COMPANY_OWNER' });
await UserModel.create({ tenantId: tenant._id, email: 'cashier@demo.local', name: 'Demo Cashier', passwordHash, role: 'CASHIER', branchIds: [branch._id] });
await UserModel.create({ tenantId: tenant._id, email: 'finance@demo.local', name: 'Demo Finance', passwordHash, role: 'FINANCE_MANAGER' });
const verification = { source: 'DEMO PLACEHOLDER — verify before real use', verifiedBy: 'nobody (demo)', verifiedAt: new Date(), notes: 'Replace with a verified rule' };
await TaxConfigurationModel.create([
  { tenantId: tenant._id, code: 'VAT_STD', version: 1, name: 'VAT standard (DEMO)', etaTaxType: 'T1', etaSubType: 'V009', treatment: 'PERCENTAGE', rate: '14', effectiveFrom: new Date('2020-01-01'), verification, createdBy: owner._id },
  { tenantId: tenant._id, code: 'VAT_EXEMPT', version: 1, name: 'VAT exempt (DEMO)', etaTaxType: 'T1', etaSubType: 'V003', treatment: 'EXEMPT', rate: '0', effectiveFrom: new Date('2020-01-01'), verification, createdBy: owner._id },
]);
const p = { tenantId: tenant._id, kind: 'GOODS', etaItemType: 'EGS', unitType: 'EA' };
await ProductModel.create([
  { ...p, internalCode: 'DEMO-001', barcode: '6220000000017', nameAr: 'مياه معدنية', nameEn: 'Mineral water', description: 'Mineral water 1.5L', etaItemCode: 'EG-000000000-001', unitPrice: '10.00', taxCodes: ['VAT_STD'] },
  { ...p, internalCode: 'DEMO-002', barcode: '6220000000024', nameAr: 'خبز', nameEn: 'Bread', description: 'Bread loaf', etaItemCode: 'EG-000000000-002', unitPrice: '5.00', taxCodes: ['VAT_EXEMPT'] },
  { ...p, internalCode: 'DEMO-003', barcode: '6220000000031', nameAr: 'قهوة', nameEn: 'Coffee', description: 'Ground coffee 250g', etaItemCode: 'EG-000000000-003', unitPrice: '120.00', taxCodes: ['VAT_STD'] },
]);
console.log(`Seeded DEMO data. Users: platform@demo.local, owner@demo.local, cashier@demo.local, finance@demo.local (password: ${process.env.SEED_PASSWORD ? 'from SEED_PASSWORD' : password})`);
}
