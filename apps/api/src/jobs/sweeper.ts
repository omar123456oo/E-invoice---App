import type { Types } from 'mongoose';
import { logger } from '../common/logging/logger.js';
import { getEtaService } from '../modules/eta/eta-integration.service.js';
import { ReceiptModel } from '../modules/receipts/receipt.model.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { notify, processEmailOutbox } from '../modules/notifications/notification.service.js';
import { processPendingImports } from '../modules/imports/import.service.js';

export const WINDOW_ALERT_HOURS = 20;

export interface SweepResult {
  devicesSubmitted: number;
  submissionsPolled: number;
  receiptsReconciled: number;
  errors: number;
}

/**
 * Database-driven safety net: finds outstanding ETA work and performs it.
 * Because the receipt documents are the source of truth, a lost queue job
 * only delays work until the next sweep; it can never lose a receipt.
 */
export async function sweepTenant(tenantId: Types.ObjectId): Promise<SweepResult> {
  const svc = getEtaService();
  const now = new Date();
  const result: SweepResult = { devicesSubmitted: 0, submissionsPolled: 0, receiptsReconciled: 0, errors: 0 };

  const unknown = await ReceiptModel.find({ tenantId, 'eta.status': 'UNKNOWN', $or: [{ 'eta.nextAttemptAt': null }, { 'eta.nextAttemptAt': { $lte: now } }] }, { _id: 1 }).limit(50).lean();
  for (const r of unknown) {
    try {
      await svc.reconcileReceipt(tenantId, r._id);
      result.receiptsReconciled++;
    } catch (err) {
      result.errors++;
      logger.warn({ err, receiptId: String(r._id) }, 'Reconciliation failed');
    }
  }

  const devices: Types.ObjectId[] = await ReceiptModel.distinct('deviceId', { tenantId, 'eta.status': 'QUEUED' });
  for (const deviceId of devices) {
    try {
      const res = await svc.submitDevice(tenantId, deviceId);
      if (res.outcome === 'SUBMITTED') result.devicesSubmitted++;
    } catch (err) {
      result.errors++;
      logger.warn({ err, deviceId: String(deviceId) }, 'Device submission failed');
    }
  }

  // Alert once when a receipt has not reached ETA 20 hours after issuance (FAQ: 24-hour submission window).
  const late = await ReceiptModel.find({
    tenantId, 'eta.status': { $in: ['NOT_SUBMITTED', 'QUEUED', 'UNKNOWN', 'FAILED'] }, 'eta.windowAlertedAt': null,
    dateTimeIssued: { $lte: new Date(now.getTime() - WINDOW_ALERT_HOURS * 3_600_000) },
  }, { _id: 1, receiptNumber: 1 }).limit(200).lean();
  if (late.length) {
    await ReceiptModel.updateMany({ tenantId, _id: { $in: late.map((r) => r._id) } }, { $set: { 'eta.windowAlertedAt': now } });
    const numbers = late.slice(0, 10).map((r) => r.receiptNumber).join(', ');
    await notify({
      tenantId, kind: 'ETA_SUBMISSION_WINDOW', severity: 'critical', permission: 'receipts:submit',
      title: { en: `${late.length} receipt(s) near the 24-hour submission limit`, ar: `${late.length} إيصال يقترب من حد الإرسال (24 ساعة)` },
      body: { en: `Not yet registered more than ${WINDOW_ALERT_HOURS} hours after issue: ${numbers}`, ar: `لم تُسجل بعد مرور أكثر من ${WINDOW_ALERT_HOURS} ساعة على إصدارها: ${numbers}` },
      link: '/receipts', dedupeKey: `window:${now.toISOString().slice(0, 13)}:${late.length}:${String(late[0]!._id)}`,
    });
  }

  const pollBefore = new Date(now.getTime() - 15_000);
  const submissions: Array<string | null> = await ReceiptModel.distinct('eta.submissionUuid', { tenantId, 'eta.status': 'SUBMITTED', 'eta.statusChangedAt': { $lte: pollBefore } });
  for (const uuid of submissions.filter((u): u is string => Boolean(u)).slice(0, 50)) {
    try {
      await svc.pollSubmission(tenantId, uuid);
      result.submissionsPolled++;
    } catch (err) {
      result.errors++;
      logger.warn({ err, submissionUuid: uuid }, 'Submission poll failed');
    }
  }
  return result;
}

export async function sweepAll(): Promise<void> {
  try {
    await processPendingImports();
  } catch (err) {
    logger.error({ err }, 'Import processing failed');
  }
  try {
    await processEmailOutbox();
  } catch (err) {
    logger.error({ err }, 'Email outbox processing failed');
  }
  const tenants = await TenantModel.find({ status: 'ACTIVE', 'eta.submissionEnabled': true }, { _id: 1 }).lean();
  for (const t of tenants) {
    try {
      await sweepTenant(t._id);
    } catch (err) {
      logger.error({ err, tenantId: String(t._id) }, 'Sweep failed');
    }
  }
}

let timer: NodeJS.Timeout | undefined;
let running = false;

/** In-process scheduler, used when no Redis/BullMQ worker is configured (development). */
export function startInProcessSweeper(intervalMs = 30_000): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    sweepAll().finally(() => {
      running = false;
    });
  }, intervalMs);
  timer.unref();
}

export function stopInProcessSweeper(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
