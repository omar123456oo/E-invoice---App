import request from 'supertest';
import { authenticator } from 'otplib';
import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/modules/users/user.model.js';
import { AuditEventModel } from '../src/modules/audit/audit-event.model.js';
import { getMailer, type MemoryMailer } from '../src/modules/notifications/mailer.js';
import { bearer, login, PASSWORD, seedCompany, useTestApp } from './helpers.js';

const t = useTestApp();

function refreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[];
  const c = raw.find((x) => x.startsWith('rt='));
  if (!c) throw new Error('no refresh cookie');
  return c.split(';')[0]!;
}

describe('authentication', () => {
  it('signs in, returns permissions, and records login history', async () => {
    const s = await seedCompany();
    const res = await request(t.app).post('/api/v1/auth/login').send({ email: s.users.CASHIER!.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = res.headers['set-cookie'] as unknown as string[];
    expect(cookie.find((c) => c.startsWith('rt='))).toMatch(/HttpOnly/i);
    const me = await request(t.app).get('/api/v1/auth/me').set(bearer(res.body.accessToken));
    expect(me.body.permissions).toContain('sales:checkout');
    expect(me.body.permissions).not.toContain('products:manage');
    expect(await AuditEventModel.countDocuments({ tenantId: s.tenantId, action: 'auth.login', outcome: 'success' })).toBe(1);
  });

  it('gives the same error for unknown accounts and wrong passwords', async () => {
    const s = await seedCompany();
    const a = await request(t.app).post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: 'x' });
    const b = await request(t.app).post('/api/v1/auth/login').send({ email: s.users.CASHIER!.email, password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.code).toBe(b.body.error.code);
  });

  it('locks the account after 5 failed attempts', async () => {
    const s = await seedCompany();
    for (let i = 0; i < 5; i++) await request(t.app).post('/api/v1/auth/login').send({ email: s.users.ACCOUNTANT!.email, password: 'wrong-password' });
    const res = await request(t.app).post('/api/v1/auth/login').send({ email: s.users.ACCOUNTANT!.email, password: PASSWORD });
    expect(res.status).toBe(423);
  });

  it('rotates refresh tokens and revokes the session when an old token is reused', async () => {
    const s = await seedCompany();
    const res = await request(t.app).post('/api/v1/auth/login').send({ email: s.users.CASHIER!.email, password: PASSWORD });
    const first = refreshCookie(res);
    const noHeader = await request(t.app).post('/api/v1/auth/refresh').set('Cookie', first);
    expect(noHeader.status).toBe(403);
    const r1 = await request(t.app).post('/api/v1/auth/refresh').set('Cookie', first).set('X-Requested-With', 'XMLHttpRequest');
    expect(r1.status).toBe(200);
    const second = refreshCookie(r1);
    expect(second).not.toBe(first);
    const reuse = await request(t.app).post('/api/v1/auth/refresh').set('Cookie', first).set('X-Requested-With', 'XMLHttpRequest');
    expect(reuse.status).toBe(401);
    const afterReuse = await request(t.app).post('/api/v1/auth/refresh').set('Cookie', second).set('X-Requested-With', 'XMLHttpRequest');
    expect(afterReuse.status).toBe(401);
    expect((await request(t.app).get('/api/v1/auth/me').set(bearer(r1.body.accessToken))).status).toBe(401);
  });

  it('logout and deactivation take effect immediately', async () => {
    const s = await seedCompany();
    const token = await login(t.app, s.users.CASHIER!.email);
    expect((await request(t.app).post('/api/v1/auth/logout').set(bearer(token))).status).toBe(204);
    expect((await request(t.app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);

    const token2 = await login(t.app, s.users.CASHIER!.email);
    const admin = await login(t.app, s.users.COMPANY_ADMIN!.email);
    const deact = await request(t.app).patch(`/api/v1/users/${s.users.CASHIER!.id}`).set(bearer(admin)).send({ isActive: false });
    expect(deact.status).toBe(200);
    expect((await request(t.app).get('/api/v1/auth/me').set(bearer(token2))).status).toBe(401);
  });

  it('enrols and enforces TOTP multi-factor authentication', async () => {
    const s = await seedCompany();
    const token = await login(t.app, s.users.FINANCE_MANAGER!.email);
    const setup = await request(t.app).post('/api/v1/auth/mfa/setup').set(bearer(token));
    expect(setup.status).toBe(200);
    const confirm = await request(t.app).post('/api/v1/auth/mfa/confirm').set(bearer(token)).send({ code: authenticator.generate(setup.body.secret) });
    expect(confirm.status).toBe(204);
    const noCode = await request(t.app).post('/api/v1/auth/login').send({ email: s.users.FINANCE_MANAGER!.email, password: PASSWORD });
    expect(noCode.body.error.code).toBe('MFA_REQUIRED');
    const withCode = await request(t.app).post('/api/v1/auth/login').send({ email: s.users.FINANCE_MANAGER!.email, password: PASSWORD, totp: authenticator.generate(setup.body.secret) });
    expect(withCode.status).toBe(200);
    const stored = await UserModel.findOne({ _id: s.users.FINANCE_MANAGER!.id }).select('+mfa.secretEnc').setOptions({ skipTenantGuard: true }).lean();
    expect(stored!.mfa!.secretEnc).not.toContain(setup.body.secret);
  });

  it('resets a password with a single-use emailed token and does not reveal unknown emails', async () => {
    const s = await seedCompany();
    const mailer = getMailer() as MemoryMailer;
    const unknown = await request(t.app).post('/api/v1/auth/password/forgot').send({ email: 'ghost@example.test' });
    expect(unknown.status).toBe(202);
    const before = mailer.outbox.length;
    await request(t.app).post('/api/v1/auth/password/forgot').send({ email: s.users.AUDITOR!.email });
    expect(mailer.outbox.length).toBe(before + 1);
    const token = /token=([\w-]+)/.exec(mailer.outbox.at(-1)!.text)![1]!;
    const newPassword = 'a-brand-new-password';
    expect((await request(t.app).post('/api/v1/auth/password/reset').send({ token, newPassword })).status).toBe(204);
    expect((await request(t.app).post('/api/v1/auth/password/reset').send({ token, newPassword })).status).toBe(422);
    await login(t.app, s.users.AUDITOR!.email, newPassword);
  });
});

describe('authorization and tenant isolation', () => {
  it('enforces permissions on the server', async () => {
    const s = await seedCompany();
    const cashier = await login(t.app, s.users.CASHIER!.email);
    const auditor = await login(t.app, s.users.AUDITOR!.email);
    const support = await login(t.app, s.users.TECH_SUPPORT!.email);
    const product = { kind: 'GOODS', internalCode: 'X1', nameAr: 'س', description: 'x', etaItemType: 'EGS', etaItemCode: 'EG-1-1', unitType: 'EA', unitPrice: '1.00', taxCodes: ['VAT_STD'] };
    expect((await request(t.app).post('/api/v1/products').set(bearer(cashier)).send(product)).status).toBe(403);
    expect((await request(t.app).post('/api/v1/pos/checkout').set(bearer(auditor)).send({})).status).toBe(403);
    expect((await request(t.app).get('/api/v1/customers').set(bearer(support))).status).toBe(403);
    expect((await request(t.app).get('/api/v1/audit-events').set(bearer(support))).status).toBe(403);
    expect((await request(t.app).get('/api/v1/eta/status').set(bearer(support))).status).toBe(200);
  });

  it('prevents privilege escalation when managing users', async () => {
    const s = await seedCompany();
    const admin = await login(t.app, s.users.COMPANY_ADMIN!.email);
    const res = await request(t.app).post('/api/v1/users').set(bearer(admin)).send({ name: 'Evil', email: 'evil@example.test', password: 'long-enough-pass', role: 'COMPANY_OWNER' });
    expect(res.status).toBe(403);
    const self = await request(t.app).patch(`/api/v1/users/${s.users.COMPANY_ADMIN!.id}`).set(bearer(admin)).send({ role: 'CASHIER' });
    expect(self.status).toBe(422);
  });

  it('isolates tenants from each other', async () => {
    const a = await seedCompany();
    const b = await seedCompany();
    const tokenB = await login(t.app, b.users.COMPANY_OWNER!.email);
    expect((await request(t.app).get(`/api/v1/products/${a.products.taxed}`).set(bearer(tokenB))).status).toBe(404);
    const list = await request(t.app).get('/api/v1/products').set(bearer(tokenB));
    expect(list.body.items.every((p: { tenantId: string }) => p.tenantId === String(b.tenantId))).toBe(true);
    const patch = await request(t.app).patch(`/api/v1/products/${a.products.taxed}`).set(bearer(tokenB)).send({ unitPrice: '0.01' });
    expect(patch.status).toBe(404);
  });

  it('strips unknown properties (no mass assignment) and rejects operator injection', async () => {
    const s = await seedCompany();
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    const res = await request(t.app).patch(`/api/v1/products/${s.products.taxed}`).set(bearer(owner)).send({ nameAr: 'جديد', tenantId: '000000000000000000000000' });
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(String(s.tenantId));
    const inj = await request(t.app).post('/api/v1/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(inj.status).toBe(422);
  });
});
