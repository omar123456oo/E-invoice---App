import type { Types } from 'mongoose';
import { logger } from '../../common/logging/logger.js';
import { ROLE_PERMISSIONS, type Permission, type Role } from '../../common/security/permissions.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { UserModel } from '../users/user.model.js';
import { getMailer } from './mailer.js';
import { NotificationJobModel, NotificationModel } from './notification.model.js';

export interface Bilingual { en: string; ar: string }

export interface NotifyInput {
  tenantId: Types.ObjectId;
  kind: 'ETA_RECEIPT_PROBLEM' | 'ETA_SUBMISSION_WINDOW' | 'CASH_VARIANCE' | 'IMPORT_FINISHED' | 'JOB_FAILED';
  severity: 'info' | 'warning' | 'critical';
  /** Recipients: every active user holding this permission, and/or explicit users. */
  permission?: Permission;
  userIds?: Types.ObjectId[];
  title: Bilingual;
  body: Bilingual;
  link?: string;
  entityType?: string;
  entityId?: string;
  dedupeKey: string;
}

const MAX_ATTEMPTS = 6;

function rolesWith(p: Permission): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => r !== 'PLATFORM_ADMIN' && ROLE_PERMISSIONS[r].includes(p));
}

/**
 * Creates one notification per recipient (idempotent per dedupeKey) and, when
 * the company enabled email alerts, queues emails for warnings and criticals.
 * Failures are logged and never break the business operation that triggered them.
 */
export async function notify(input: NotifyInput): Promise<number> {
  try {
    const filter: Record<string, unknown> = { tenantId: input.tenantId, isActive: true };
    const or: Record<string, unknown>[] = [];
    if (input.permission) or.push({ role: { $in: rolesWith(input.permission) } });
    if (input.userIds?.length) or.push({ _id: { $in: input.userIds } });
    if (or.length === 0) return 0;
    filter.$or = or;
    const [users, tenant] = await Promise.all([UserModel.find(filter, { email: 1, locale: 1 }).lean(), TenantModel.findById(input.tenantId, { 'settings.emailAlerts': 1 }).lean()]);
    let created = 0;
    for (const u of users) {
      try {
        const n = await NotificationModel.create({
          tenantId: input.tenantId, userId: u._id, kind: input.kind, severity: input.severity, title: input.title, body: input.body,
          link: input.link ?? null, entityType: input.entityType ?? null, entityId: input.entityId ?? null, dedupeKey: input.dedupeKey,
        });
        created++;
        if (tenant?.settings?.emailAlerts && input.severity !== 'info') {
          const ar = u.locale !== 'en';
          await NotificationJobModel.create({
            tenantId: input.tenantId, notificationId: n._id, to: u.email,
            subject: ar ? input.title.ar : input.title.en,
            text: `${ar ? input.body.ar : input.body.en}\n\n${ar ? input.body.en : input.body.ar}`,
          });
        }
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // duplicate = already notified
      }
    }
    return created;
  } catch (err) {
    logger.error({ err, kind: input.kind }, 'Notification could not be created');
    return 0;
  }
}

/** Sends pending emails across all tenants (platform-level job). */
export async function processEmailOutbox(limit = 50, now = new Date()): Promise<{ sent: number; failed: number }> {
  const jobs = await NotificationJobModel.find({ status: 'PENDING', nextAttemptAt: { $lte: now } }).setOptions({ skipTenantGuard: true }).sort({ nextAttemptAt: 1 }).limit(limit).lean();
  let sent = 0;
  let failed = 0;
  for (const j of jobs) {
    try {
      await getMailer().send({ to: j.to, subject: j.subject, text: j.text });
      await NotificationJobModel.updateOne({ _id: j._id, tenantId: j.tenantId }, { $set: { status: 'SENT', sentAt: new Date() }, $inc: { attempts: 1 } });
      sent++;
    } catch (err) {
      const attempts = j.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await NotificationJobModel.updateOne(
        { _id: j._id, tenantId: j.tenantId },
        { $set: { status: final ? 'FAILED' : 'PENDING', lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500), nextAttemptAt: new Date(now.getTime() + 2 ** attempts * 60_000) }, $inc: { attempts: 1 } },
      );
      if (final) failed++;
      logger.warn({ jobId: String(j._id), attempts }, 'Email delivery failed');
    }
  }
  return { sent, failed };
}
