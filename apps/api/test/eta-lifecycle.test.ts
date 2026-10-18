import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { RECONCILE_GRACE_MS } from '../src/modules/eta/eta-integration.service.js';
import { EtaSubmissionModel } from '../src/modules/eta/eta-submission.model.js';
import { ReceiptModel } from '../src/modules/receipts/receipt.model.js';
import { PosDeviceModel } from '../src/modules/pos/pos-device.model.js';
import { bearer, login, openShift, seedCompany, sell, useTestApp } from './helpers.js';

// All ETA responses in this file come from the SIMULATED ETA test double. Passing tests here
// prove our state handling, not acceptance by the Egyptian Tax Authority.
const t = useTestApp();

async function saleSetup(count = 1) {
  const s = await seedCompany({ submissionEnabled: true });
  const token = await login(t.app, s.users.CASHIER!.email);
  await openShift(t.app, token, s.deviceId);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await sell(t.app, token, { deviceId: String(s.deviceId), items: [{ productId: String(s.products.taxed), quantity: '1' }], payments: [{ method: 'CASH', amount: '57.00' }] });
    ids.push(r.body.receipt.id);
  }
  return { s, token, ids };
}

const status = async (tenantId: unknown, id: string) => (await ReceiptModel.findOne({ tenantId, _id: id }).lean())!.eta;

describe('ETA receipt lifecycle (SIMULATED ETA)', () => {
  beforeEach(() => {
    t.eta.behaviour = 'accept';
    t.eta.timeoutButProcessed = false;
    t.eta.validationOutcome = () => 'Valid';
    t.eta.pollsUntilValidated = 0;
    t.clock.now = new Date();
  });

  it('queues on issue, submits in chain order, then becomes VALID after polling', async () => {
    const { s, ids } = await saleSetup(3);
    expect((await status(s.tenantId, ids[0]!)).status).toBe('QUEUED');
    const res = await t.service.submitDevice(s.tenantId, s.deviceId);
    expect(res).toMatchObject({ outcome: 'SUBMITTED', accepted: 3, rejected: 0 });
    const sent = t.eta.calls.filter((c) => c.op === 'submit').at(-1)!.body!;
    const order = [...sent.matchAll(/"receiptNumber":"(P1-\d+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['P1-00000001', 'P1-00000002', 'P1-00000003']);
    const e = await status(s.tenantId, ids[0]!);
    expect(e.status).toBe('SUBMITTED');
    expect(e.submissionUuid).toBeTruthy();
    expect(e.longId).toMatch(/^SIMLONG/);
    await t.service.pollSubmission(s.tenantId, e.submissionUuid!);
    for (const id of ids) expect((await status(s.tenantId, id)).status).toBe('VALID');
    const sub = await EtaSubmissionModel.findOne({ tenantId: s.tenantId }).lean();
    expect(sub).toMatchObject({ status: 'ACCEPTED', environment: 'simulated', acceptedCount: 3 });
  });

  it('records INVALID results with ETA validation errors', async () => {
    const { s, ids } = await saleSetup(1);
    t.eta.validationOutcome = () => 'Invalid';
    await t.service.submitDevice(s.tenantId, s.deviceId);
    const e = await status(s.tenantId, ids[0]!);
    await t.service.pollSubmission(s.tenantId, e.submissionUuid!);
    const after = await status(s.tenantId, ids[0]!);
    expect(after.status).toBe('INVALID');
    expect(after.lastError?.code).toBe('ETA_INVALID');
  });

  it('marks receipts REJECTED when ETA rejects them at submission', async () => {
    const { s, ids, token } = await saleSetup(1);
    t.eta.behaviour = 'reject-all';
    await t.service.submitDevice(s.tenantId, s.deviceId);
    const e = await status(s.tenantId, ids[0]!);
    expect(e.status).toBe('REJECTED');
    expect(e.lastError?.message).toContain('SIMULATED');
    const view = await request(t.app).get(`/api/v1/receipts/${ids[0]}`).set(bearer(token));
    expect(view.body.registration.officiallyRegistered).toBe(false);
  });

  it('on timeout marks UNKNOWN, never resends blindly, and reconciles to the official status', async () => {
    const { s, ids } = await saleSetup(1);
    t.eta.behaviour = 'timeout';
    t.eta.timeoutButProcessed = true;
    const r = await t.service.submitDevice(s.tenantId, s.deviceId);
    expect(r.outcome).toBe('UNKNOWN');
    expect((await status(s.tenantId, ids[0]!)).status).toBe('UNKNOWN');

    // A further submit run must not resend while the outcome is unknown.
    t.eta.behaviour = 'accept';
    const submitsBefore = t.eta.calls.filter((c) => c.op === 'submit').length;
    expect((await t.service.submitDevice(s.tenantId, s.deviceId)).reason).toBe('RECONCILIATION_PENDING');
    expect(t.eta.calls.filter((c) => c.op === 'submit').length).toBe(submitsBefore);

    const final = await t.service.reconcileReceipt(s.tenantId, (await ReceiptModel.findOne({ tenantId: s.tenantId, _id: ids[0] }).lean())!._id);
    expect(final).toBe('VALID');
  });

  it('requeues an unknown receipt only after it has been absent at ETA beyond the grace period', async () => {
    const { s, ids } = await saleSetup(1);
    t.eta.behaviour = 'timeout';
    t.eta.timeoutButProcessed = false;
    await t.service.submitDevice(s.tenantId, s.deviceId);
    const id = (await ReceiptModel.findOne({ tenantId: s.tenantId, _id: ids[0] }).lean())!._id;
    expect(await t.service.reconcileReceipt(s.tenantId, id)).toBe('UNKNOWN');
    t.clock.now = new Date(Date.now() + RECONCILE_GRACE_MS + 1000);
    expect(await t.service.reconcileReceipt(s.tenantId, id)).toBe('QUEUED');
    t.eta.behaviour = 'accept';
    expect((await t.service.submitDevice(s.tenantId, s.deviceId)).outcome).toBe('SUBMITTED');
  });

  it('treats 422 DuplicateSubmission as UNKNOWN (already received) and 5xx as UNKNOWN', async () => {
    const a = await saleSetup(1);
    t.eta.behaviour = 'duplicate';
    expect((await t.service.submitDevice(a.s.tenantId, a.s.deviceId)).reason).toBe('DUPLICATE_SUBMISSION');
    expect((await status(a.s.tenantId, a.ids[0]!)).status).toBe('UNKNOWN');
    const b = await saleSetup(1);
    t.eta.behaviour = 'server-error';
    expect((await t.service.submitDevice(b.s.tenantId, b.s.deviceId)).outcome).toBe('UNKNOWN');
  });

  it('puts receipts back in the queue on 401 and 429 (not processed by ETA)', async () => {
    const a = await saleSetup(1);
    t.eta.behaviour = 'unauthorized';
    // Authentication itself fails in this mode, so nothing is sent.
    expect((await t.service.submitDevice(a.s.tenantId, a.s.deviceId)).reason).toBe('ETA_AUTH_FAILED');
    expect((await status(a.s.tenantId, a.ids[0]!)).status).toBe('QUEUED');
    const b = await saleSetup(1);
    t.eta.behaviour = 'throttle';
    expect((await t.service.submitDevice(b.s.tenantId, b.s.deviceId)).reason).toBe('THROTTLED');
    const e = await status(b.s.tenantId, b.ids[0]!);
    expect(e.status).toBe('QUEUED');
    expect(e.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it('fails on bad structure and allows an authorized operator to requeue after a fix', async () => {
    const { s, ids } = await saleSetup(1);
    t.eta.behaviour = 'bad-structure';
    expect((await t.service.submitDevice(s.tenantId, s.deviceId)).outcome).toBe('FAILED');
    expect((await status(s.tenantId, ids[0]!)).status).toBe('FAILED');
    const cashier = await login(t.app, s.users.CASHIER!.email);
    expect((await request(t.app).post(`/api/v1/receipts/${ids[0]}/submit`).set(bearer(cashier)).send({ reason: 'fixed' })).status).toBe(403);
    const manager = await login(t.app, s.users.FINANCE_MANAGER!.email);
    const requeue = await request(t.app).post(`/api/v1/receipts/${ids[0]}/submit`).set(bearer(manager)).send({ reason: 'item codes corrected' });
    expect(requeue.status).toBe(200);
    expect(requeue.body.eta.status).toBe('QUEUED');
  });

  it('does not submit when the company has not enabled submission', async () => {
    const s = await seedCompany({ submissionEnabled: false });
    expect((await t.service.submitDevice(s.tenantId, s.deviceId)).reason).toBe('SUBMISSION_DISABLED');
  });

  it('allows only one submitter per device at a time', async () => {
    const { s } = await saleSetup(2);
    const before = t.eta.calls.filter((c) => c.op === 'submit').length;
    const [a, b] = await Promise.all([t.service.submitDevice(s.tenantId, s.deviceId), t.service.submitDevice(s.tenantId, s.deviceId)]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toContain('SUBMITTED');
    expect([a.reason, b.reason]).toContain('DEVICE_LOCKED');
    expect(t.eta.calls.filter((c) => c.op === 'submit').length - before).toBe(1);
  });

  it('exposes integration status with a SIMULATED warning', async () => {
    const { s } = await saleSetup(0);
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    const res = await request(t.app).get('/api/v1/eta/status').set(bearer(owner));
    expect(res.body.simulated).toBe(true);
    expect(res.body.warnings.join(' ')).toContain('SIMULATED');
  });

  it('clears credential backoff when new device credentials are saved (regression)', async () => {
    const { s, ids } = await saleSetup(1);
    await PosDeviceModel.updateOne({ tenantId: s.tenantId, _id: s.deviceId }, { $set: { etaCredentialsEnc: null } });
    expect((await t.service.submitDevice(s.tenantId, s.deviceId)).reason).toBe('ETA_CREDENTIALS_MISSING');
    expect((await t.service.submitDevice(s.tenantId, s.deviceId)).reason).toBe('BACKOFF');
    const owner = await login(t.app, s.users.COMPANY_OWNER!.email);
    const put = await request(t.app).put(`/api/v1/pos-devices/${s.deviceId}/eta-credentials`).set(bearer(owner)).send({ clientId: 'c', clientSecret: 's', presharedKey: '' });
    expect(put.status).toBe(204);
    expect((await t.service.submitDevice(s.tenantId, s.deviceId)).outcome).toBe('SUBMITTED');
    expect((await status(s.tenantId, ids[0]!)).status).toBe('SUBMITTED');
  });
});
