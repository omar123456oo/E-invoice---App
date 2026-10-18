import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { sweepTenant } from '../src/jobs/sweeper.js';
import { getMailer, setMailer, MemoryMailer, type Mailer } from '../src/modules/notifications/mailer.js';
import { NotificationJobModel, NotificationModel } from '../src/modules/notifications/notification.model.js';
import { processEmailOutbox } from '../src/modules/notifications/notification.service.js';
import { ReceiptModel } from '../src/modules/receipts/receipt.model.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { bearer, login, openShift, seedCompany, sell, useTestApp } from './helpers.js';

const t = useTestApp();

describe('notifications', () => {
  it('alerts users who can act on a rejected receipt, once, and queues email when enabled', async () => {
    const s = await seedCompany({ submissionEnabled: true });
    await TenantModel.updateOne({ _id: s.tenantId }, { $set: { 'settings.emailAlerts': true } });
    const cashier = await login(t.app, s.users.CASHIER!.email);
    await openShift(t.app, cashier, s.deviceId);
    await sell(t.app, cashier, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CASH', amount: '10.00' }] });
    t.eta.behaviour = 'reject-all';
    await t.service.submitDevice(s.tenantId, s.deviceId);
    t.eta.behaviour = 'accept';

    const manager = await login(t.app, s.users.FINANCE_MANAGER!.email);
    const list = await request(t.app).get('/api/v1/notifications').set(bearer(manager));
    expect(list.body.unread).toBe(1);
    expect(list.body.items[0]).toMatchObject({ kind: 'ETA_RECEIPT_PROBLEM', severity: 'warning' });
    expect(list.body.items[0].title.ar).toContain('مصلحة الضرائب');
    const cashierList = await request(t.app).get('/api/v1/notifications').set(bearer(cashier));
    expect(cashierList.body.total).toBe(0);

    const before = (getMailer() as MemoryMailer).outbox.length;
    expect(await NotificationJobModel.countDocuments({ tenantId: s.tenantId, status: 'PENDING' })).toBeGreaterThanOrEqual(3);
    await processEmailOutbox(100);
    expect((getMailer() as MemoryMailer).outbox.length).toBeGreaterThan(before);

    await request(t.app).post(`/api/v1/notifications/${list.body.items[0].id}/read`).set(bearer(manager));
    expect((await request(t.app).get('/api/v1/notifications/unread-count').set(bearer(manager))).body.unread).toBe(0);
  });

  it('retries failed emails with backoff and marks them FAILED after the last attempt', async () => {
    const s = await seedCompany();
    const job = await NotificationJobModel.create({ tenantId: s.tenantId, to: 'x@example.test', subject: 's', text: 't' });
    const original = getMailer();
    const failing: Mailer = { send: async () => { throw new Error('SMTP down'); } };
    setMailer(failing);
    try {
      for (let i = 1; i <= 6; i++) await processEmailOutbox(100, new Date(Date.now() + i * 10 ** 9));
    } finally {
      setMailer(original);
    }
    const after = await NotificationJobModel.findOne({ tenantId: s.tenantId, _id: job._id }).lean();
    expect(after).toMatchObject({ status: 'FAILED', attempts: 6, lastError: 'SMTP down' });
  });

  it('alerts managers on cash variance at shift close', async () => {
    const s = await seedCompany({ submissionEnabled: false });
    const cashier = await login(t.app, s.users.CASHIER!.email);
    const shift = await openShift(t.app, cashier, s.deviceId, '100.00');
    await request(t.app).post(`/api/v1/pos/shifts/${shift.id}/close`).set(bearer(cashier)).send({ countedCash: '95.00' });
    const n = await NotificationModel.find({ tenantId: s.tenantId, kind: 'CASH_VARIANCE' }).lean();
    expect(n.length).toBeGreaterThan(0);
    expect(n[0]!.title!.en).toContain('-5.00');
  });

  it('warns once when a receipt is not registered 20 hours after issue', async () => {
    const s = await seedCompany({ submissionEnabled: true });
    const cashier = await login(t.app, s.users.CASHIER!.email);
    await openShift(t.app, cashier, s.deviceId);
    const r = await sell(t.app, cashier, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.exempt), quantity: '1' }], payments: [{ method: 'CASH', amount: '10.00' }] });
    const id = (await ReceiptModel.findOne({ tenantId: s.tenantId, _id: r.body.receipt.id }).lean())!._id;
    await ReceiptModel.collection.updateOne({ _id: id }, { $set: { dateTimeIssued: new Date(Date.now() - 21 * 3600_000), 'eta.status': 'FAILED' } });
    await sweepTenant(s.tenantId);
    await sweepTenant(s.tenantId);
    const n = await NotificationModel.find({ tenantId: s.tenantId, kind: 'ETA_SUBMISSION_WINDOW' }).lean();
    const perUser = new Set(n.map((x) => String(x.userId)));
    expect(n.length).toBe(perUser.size);
    expect(n[0]!.severity).toBe('critical');
  });
});
