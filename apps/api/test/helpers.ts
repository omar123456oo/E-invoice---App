import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, inject } from 'vitest';
import { createApp } from '../src/app.js';
import { encryptSecret } from '../src/common/crypto/crypto.js';
import { EtaIntegrationService, setEtaService } from '../src/modules/eta/eta-integration.service.js';
import { NoSigner } from '../src/modules/eta/signer.js';
import { SimulatedEtaApi } from '../src/modules/eta/simulated-eta-api.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { BranchModel } from '../src/modules/branches/branch.model.js';
import { PosDeviceModel } from '../src/modules/pos/pos-device.model.js';
import { ProductModel } from '../src/modules/products/product.model.js';
import { TaxConfigurationModel } from '../src/modules/tax/tax-configuration.model.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import type { Role } from '../src/common/security/permissions.js';

export const PASSWORD = 'correct-horse-battery';

export interface TestEnv {
  app: Express;
  eta: SimulatedEtaApi;
  service: EtaIntegrationService;
  clock: { now: Date };
}

/** Connects to a fresh database for this test file and wires the SIMULATED ETA. */
export function useTestApp(): TestEnv {
  const envRef = {} as TestEnv;
  beforeAll(async () => {
    const uri = inject('mongoUri');
    await mongoose.connect(uri, { dbName: `t_${randomUUID().slice(0, 8)}` });
    await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
    envRef.eta = new SimulatedEtaApi();
    envRef.clock = { now: new Date() };
    envRef.service = new EtaIntegrationService({ api: envRef.eta, signer: new NoSigner(), now: () => envRef.clock.now });
    setEtaService(envRef.service);
    envRef.app = createApp();
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  return envRef;
}

export interface Seeded {
  tenantId: Types.ObjectId;
  branchId: Types.ObjectId;
  deviceId: Types.ObjectId;
  products: { taxed: Types.ObjectId; exempt: Types.ObjectId; expensive: Types.ObjectId };
  users: Record<string, { id: Types.ObjectId; email: string }>;
}

let counter = 0;

/** Seeds a company with one branch, one active device, VAT rules and products. Rates are test fixtures. */
export async function seedCompany(opts: { submissionEnabled?: boolean } = {}): Promise<Seeded> {
  const n = ++counter;
  const tag = `${n}${randomUUID().slice(0, 6)}`;
  const tenant = await TenantModel.create({
    legalName: `Test Co ${tag}`, tradeName: `Test ${tag}`, taxRegistrationNumber: `9${String(Date.now()).slice(-6)}${n}`, activityCode: '4711',
    settings: { enabledPaymentMethods: ['CASH', 'CARD', 'WALLET'] },
    eta: { onboardingStatus: 'PREPROD_TESTING', b2cTagConfirmed: true, submissionEnabled: opts.submissionEnabled ?? true },
  });
  const branch = await BranchModel.create({
    tenantId: tenant._id, name: 'Main', etaBranchCode: '0',
    address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: 'Abbas El Akkad', buildingNumber: '10' },
  });
  const device = await PosDeviceModel.create({
    tenantId: tenant._id, branchId: branch._id, name: 'Till 1', code: 'P1', serialNumber: `SN-${tag}`, osVersion: 'os', modelFramework: '1', status: 'ACTIVE',
    etaCredentialsEnc: encryptSecret(JSON.stringify({ clientId: 'test-client', clientSecret: 'test-secret', presharedKey: '' })), etaCredentialsUpdatedAt: new Date(),
  });
  const owner = new Types.ObjectId();
  const verification = { source: 'TEST FIXTURE — not a verified rate', verifiedBy: 'test', verifiedAt: new Date('2020-01-01') };
  await TaxConfigurationModel.create([
    { tenantId: tenant._id, code: 'VAT_STD', version: 1, name: 'VAT standard (test)', etaTaxType: 'T1', etaSubType: 'V009', treatment: 'PERCENTAGE', rate: '14', effectiveFrom: new Date('2020-01-01'), verification, createdBy: owner },
    { tenantId: tenant._id, code: 'VAT_EXEMPT', version: 1, name: 'VAT exempt (test)', etaTaxType: 'T1', etaSubType: 'V003', treatment: 'EXEMPT', rate: '0', effectiveFrom: new Date('2020-01-01'), verification, createdBy: owner },
  ]);
  const base = { tenantId: tenant._id, kind: 'GOODS', etaItemType: 'EGS', unitType: 'EA', etaCodeStatus: 'APPROVED' };
  const [taxed, exempt, expensive] = await ProductModel.create([
    { ...base, internalCode: 'SKU-1', barcode: `62${tag}1`.padEnd(13, '0'), nameAr: 'منتج خاضع', nameEn: 'Taxed item', description: 'Taxed item', etaItemCode: `EG-${tenant.taxRegistrationNumber}-1`, unitPrice: '50.00', taxCodes: ['VAT_STD'] },
    { ...base, internalCode: 'SKU-2', nameAr: 'منتج معفى', nameEn: 'Exempt item', description: 'Exempt item', etaItemCode: `EG-${tenant.taxRegistrationNumber}-2`, unitPrice: '10.00', taxCodes: ['VAT_EXEMPT'] },
    { ...base, internalCode: 'SKU-3', nameAr: 'منتج غالي', nameEn: 'Expensive item', description: 'Expensive item', etaItemCode: `EG-${tenant.taxRegistrationNumber}-3`, unitPrice: '100000.00', taxCodes: ['VAT_STD'] },
  ]);

  const passwordHash = await hashPassword(PASSWORD);
  const roles: Role[] = ['COMPANY_OWNER', 'COMPANY_ADMIN', 'FINANCE_MANAGER', 'CASHIER', 'ACCOUNTANT', 'AUDITOR', 'TECH_SUPPORT'];
  const users: Seeded['users'] = {};
  for (const role of roles) {
    const email = `${role.toLowerCase()}-${tag}@example.test`;
    const u = await UserModel.create({ tenantId: tenant._id, email, name: role, passwordHash, role, branchIds: [branch._id] });
    users[role] = { id: u._id, email };
  }
  const cashier2 = await UserModel.create({ tenantId: tenant._id, email: `cashier2-${tag}@example.test`, name: 'Cashier 2', passwordHash, role: 'CASHIER', branchIds: [branch._id] });
  users.CASHIER2 = { id: cashier2._id, email: cashier2.email };
  return { tenantId: tenant._id, branchId: branch._id, deviceId: device._id, products: { taxed: taxed!._id, exempt: exempt!._id, expensive: expensive!._id }, users };
}

export async function login(app: Express, email: string, password = PASSWORD): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const idemKey = () => randomUUID();

export async function openShift(app: Express, token: string, deviceId: Types.ObjectId, openingCash = '500.00') {
  const res = await request(app).post('/api/v1/pos/shifts').set(bearer(token)).send({ deviceId: String(deviceId), openingCash });
  if (res.status !== 201) throw new Error(`open shift failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string };
}

export async function sell(app: Express, token: string, body: Record<string, unknown>, key = idemKey()) {
  return request(app).post('/api/v1/pos/checkout').set(bearer(token)).set('Idempotency-Key', key).send(body);
}
