import { env } from '../../config/env.js';
import { OFFICIALLY_REGISTERED, type EtaStatus } from './eta-status.js';
import type { ReceiptModel } from './receipt.model.js';

const REGISTRATION_LABELS: Record<EtaStatus, { en: string; ar: string }> = {
  NOT_SUBMITTED: { en: 'Not submitted to ETA', ar: 'لم يتم الإرسال إلى مصلحة الضرائب' },
  QUEUED: { en: 'Pending submission to ETA', ar: 'في انتظار الإرسال إلى مصلحة الضرائب' },
  SUBMITTING: { en: 'Submitting to ETA', ar: 'جارٍ الإرسال إلى مصلحة الضرائب' },
  UNKNOWN: { en: 'ETA status being verified', ar: 'جارٍ التحقق من الحالة لدى مصلحة الضرائب' },
  SUBMITTED: { en: 'Received by ETA, validation pending', ar: 'تم الاستلام، في انتظار التحقق' },
  REJECTED: { en: 'Rejected by ETA', ar: 'مرفوض من مصلحة الضرائب' },
  FAILED: { en: 'Submission failed — action required', ar: 'فشل الإرسال — مطلوب إجراء' },
  VALID: { en: 'Registered with ETA (valid)', ar: 'مسجل لدى مصلحة الضرائب (صالح)' },
  INVALID: { en: 'Invalid at ETA', ar: 'غير صالح لدى مصلحة الضرائب' },
  CANCELLED: { en: 'Cancelled at ETA', ar: 'ملغى لدى مصلحة الضرائب' },
  SUPERSEDED: { en: 'Superseded by a corrected receipt', ar: 'تم استبداله بإيصال مصحح' },
};

/** Receipt view with an explicit statement of official registration. */
export function receiptView(r: InstanceType<typeof ReceiptModel>) {
  const json = r.toJSON() as Record<string, unknown> & { eta: { status: EtaStatus; longId?: string | null } };
  const registered = OFFICIALLY_REGISTERED.has(json.eta.status);
  const template = env().ETA_RECEIPT_QR_TEMPLATE;
  return {
    ...json,
    registration: {
      officiallyRegistered: registered,
      label: REGISTRATION_LABELS[json.eta.status],
      // QR content format is not verified from ETA documentation; produced only when explicitly configured and only for VALID receipts.
      qrContent: registered && template ? template.replace('{uuid}', r.uuid).replace('{longId}', json.eta.longId ?? '') : null,
    },
  };
}

