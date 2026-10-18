import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { decryptSecret, sha256Hex } from '../../common/crypto/crypto.js';
import { AppError } from '../../common/errors/app-error.js';
import { logger } from '../../common/logging/logger.js';
import { enqueueSafely } from '../../jobs/queue.js';
import { recordAudit } from '../audit/audit.service.js';
import { PosDeviceModel } from '../pos/pos-device.model.js';
import { assertTransition, mapOfficialDocumentStatus, type EtaStatus } from '../receipts/eta-status.js';
import { ReceiptModel } from '../receipts/receipt.model.js';
import { TenantModel } from '../tenants/tenant.model.js';
import type { EtaApi, HttpOutcome, PosCredentials } from './eta-api.js';
import { EtaSubmissionModel } from './eta-submission.model.js';
import { buildSubmissionBody, type Signer } from './signer.js';
import { TokenManager } from './token-manager.js';

/** ETA Receipt Issuance FAQ: max 500 receipts / 1.5 MB per submission. We stay below both. */
export const MAX_BATCH_RECEIPTS = 100;
export const MAX_BATCH_BYTES = 1_400_000;
/** ETA 02-submit-receipt: identical payloads within 10 minutes are rejected as duplicates. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;
/** How long a receipt must be "not found" at ETA before it is considered safe to resend. */
export const RECONCILE_GRACE_MS = DUPLICATE_WINDOW_MS + 5 * 60_000;
const LOCK_MS = 2 * 60_000;

export interface SubmitResult {
  outcome: 'SUBMITTED' | 'SKIPPED' | 'NOTHING_TO_DO' | 'RETRY_LATER' | 'UNKNOWN' | 'FAILED';
  reason?: string;
  submissionId?: string;
  accepted?: number;
  rejected?: number;
}

export interface EtaIntegrationDeps {
  api: EtaApi;
  signer: Signer;
  tokens?: TokenManager;
  now?: () => Date;
}

type Lean<T> = T & { _id: Types.ObjectId };

export class EtaIntegrationService {
  readonly api: EtaApi;
  private readonly signer: Signer;
  private readonly tokens: TokenManager;
  private readonly now: () => Date;

  constructor(deps: EtaIntegrationDeps) {
    this.api = deps.api;
    this.signer = deps.signer;
    this.tokens = deps.tokens ?? new TokenManager(deps.api);
    this.now = deps.now ?? (() => new Date());
  }

  /** Moves receipts between ETA states, only from the expected source state. */
  private async move(tenantId: Types.ObjectId, ids: Types.ObjectId[], from: EtaStatus, to: EtaStatus, reason: string, set: Record<string, unknown> = {}): Promise<number> {
    if (ids.length === 0) return 0;
    assertTransition(from, to);
    const at = this.now();
    const res = await ReceiptModel.updateMany(
      { tenantId, _id: { $in: ids }, 'eta.status': from },
      {
        $set: { 'eta.status': to, 'eta.statusChangedAt': at, ...set },
        $push: { 'eta.history': { $each: [{ at, from, to, reason: reason.slice(0, 300) }], $slice: -50 } },
      },
    );
    if (res.modifiedCount !== ids.length) logger.warn({ from, to, expected: ids.length, modified: res.modifiedCount }, 'ETA status move affected fewer receipts than expected');
    if (['REJECTED', 'INVALID', 'FAILED'].includes(to)) {
      await recordAudit({ tenantId, action: `eta.receipt_${to.toLowerCase()}`, outcome: 'failure', entityType: 'Receipt', summary: `${ids.length} receipt(s): ${reason}`.slice(0, 500), changes: { receiptIds: ids.map(String) } });
    }
    return res.modifiedCount;
  }

  private async credentials(tenantId: Types.ObjectId, deviceId: Types.ObjectId): Promise<PosCredentials> {
    const d = await PosDeviceModel.findOne({ _id: deviceId, tenantId }).select('+etaCredentialsEnc').lean();
    if (!d?.etaCredentialsEnc) throw new AppError(422, 'ETA_CREDENTIALS_MISSING', 'ETA POS credentials are not configured for this device');
    const c = JSON.parse(decryptSecret(d.etaCredentialsEnc)) as { clientId: string; clientSecret: string; presharedKey: string };
    return { ...c, posSerial: d.serialNumber, posOsVersion: d.osVersion, posModelFramework: d.modelFramework };
  }

  private async token(tenantId: Types.ObjectId, deviceId: Types.ObjectId): Promise<string> {
    return this.tokens.get(`${tenantId}:${deviceId}`, () => this.credentials(tenantId, deviceId));
  }

  private async acquireLock(tenantId: Types.ObjectId, deviceId: Types.ObjectId, owner: string): Promise<boolean> {
    const now = this.now();
    const res = await PosDeviceModel.updateOne(
      { _id: deviceId, tenantId, $or: [{ 'etaLock.until': null }, { 'etaLock.until': { $lt: now } }] },
      { $set: { 'etaLock.owner': owner, 'etaLock.until': new Date(now.getTime() + LOCK_MS) } },
    );
    return res.modifiedCount === 1;
  }

  private async releaseLock(tenantId: Types.ObjectId, deviceId: Types.ObjectId, owner: string): Promise<void> {
    await PosDeviceModel.updateOne({ _id: deviceId, tenantId, 'etaLock.owner': owner }, { $set: { 'etaLock.owner': null, 'etaLock.until': null } });
  }

  private async noteError(tenantId: Types.ObjectId, ids: Types.ObjectId[], code: string, message: string, retryInMs: number | null): Promise<void> {
    await ReceiptModel.updateMany(
      { tenantId, _id: { $in: ids } },
      { $set: { 'eta.lastError': { code, message, details: null }, 'eta.nextAttemptAt': retryInMs === null ? null : new Date(this.now().getTime() + retryInMs) } },
    );
  }

  /**
   * Submits the next contiguous batch of queued receipts of one device, in
   * chain order. Only one worker can submit a device at a time (lease lock).
   */
  async submitDevice(tenantId: Types.ObjectId, deviceId: Types.ObjectId): Promise<SubmitResult> {
    const tenant = await TenantModel.findById(tenantId).lean();
    if (!tenant?.eta?.submissionEnabled) return { outcome: 'SKIPPED', reason: 'SUBMISSION_DISABLED' };
    if (this.api.environment === 'production' && tenant.eta.onboardingStatus !== 'PRODUCTION_AUTHORIZED') {
      return { outcome: 'SKIPPED', reason: 'PRODUCTION_NOT_AUTHORIZED' };
    }
    const owner = randomUUID();
    if (!(await this.acquireLock(tenantId, deviceId, owner))) return { outcome: 'SKIPPED', reason: 'DEVICE_LOCKED' };
    try {
      return await this.submitLocked(tenantId, deviceId);
    } finally {
      await this.releaseLock(tenantId, deviceId, owner);
    }
  }

  private async submitLocked(tenantId: Types.ObjectId, deviceId: Types.ObjectId): Promise<SubmitResult> {
    const device = await PosDeviceModel.findOne({ _id: deviceId, tenantId }).lean();
    if (!device) throw AppError.notFound('POS device');
    if (device.status !== 'ACTIVE') return { outcome: 'SKIPPED', reason: 'DEVICE_INACTIVE' };

    // We hold the lease, so any SUBMITTING receipt belongs to a worker that died mid-request: its outcome is unknown.
    const orphans = await ReceiptModel.find({ tenantId, deviceId, 'eta.status': 'SUBMITTING' }, { _id: 1 }).lean();
    if (orphans.length) await this.move(tenantId, orphans.map((o) => o._id), 'SUBMITTING', 'UNKNOWN', 'worker interrupted during submission', { 'eta.nextAttemptAt': this.now() });

    if (await ReceiptModel.exists({ tenantId, deviceId, 'eta.status': 'UNKNOWN' })) {
      return { outcome: 'SKIPPED', reason: 'RECONCILIATION_PENDING' };
    }

    const now = this.now();
    const queued = await ReceiptModel.find({ tenantId, deviceId, 'eta.status': 'QUEUED' })
      .select('+etaDocumentEnc').sort({ chainSeq: 1 }).limit(MAX_BATCH_RECEIPTS).lean();
    if (queued.length === 0) return { outcome: 'NOTHING_TO_DO' };
    if (queued[0]!.eta.nextAttemptAt && queued[0]!.eta.nextAttemptAt > now) return { outcome: 'RETRY_LATER', reason: 'BACKOFF' };

    // Build a contiguous batch; a return receipt waits until its original sale is VALID at ETA.
    const batch: Array<Lean<(typeof queued)[number]> & { json: string }> = [];
    let bytes = 0;
    for (const r of queued) {
      if (r.kind === 'RETURN' && r.originalReceiptId) {
        const original = await ReceiptModel.findOne({ tenantId, _id: r.originalReceiptId }, { 'eta.status': 1 }).lean();
        const st = original?.eta.status;
        if (st === 'INVALID' || st === 'REJECTED' || st === 'CANCELLED' || st === 'FAILED') {
          if (batch.length === 0) {
            await this.move(tenantId, [r._id], 'QUEUED', 'SUBMITTING', 'pre-check');
            await this.move(tenantId, [r._id], 'SUBMITTING', 'FAILED', `original sale receipt is ${st} at ETA`, { 'eta.lastError': { code: 'ORIGINAL_NOT_VALID', message: `Original receipt status is ${st}`, details: null } });
            continue;
          }
          break;
        }
        if (st !== 'VALID') break;
      }
      const json = decryptSecret(r.etaDocumentEnc as string);
      if (bytes + json.length > MAX_BATCH_BYTES && batch.length > 0) break;
      bytes += json.length;
      batch.push({ ...(r as Lean<typeof r>), json });
    }
    if (batch.length === 0) return { outcome: 'RETRY_LATER', reason: 'WAITING_FOR_ORIGINAL' };
    const ids = batch.map((b) => b._id);

    let token: string;
    let signatures;
    try {
      token = await this.token(tenantId, deviceId);
      signatures = await this.signer.sign(batch.map((b) => b.json));
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError(500, 'ETA_PREPARE_FAILED', 'Could not prepare submission');
      await this.noteError(tenantId, ids, e.code, e.message, 5 * 60_000);
      return { outcome: 'RETRY_LATER', reason: e.code };
    }

    const body = buildSubmissionBody(batch.map((b) => b.json), signatures);
    const [submission] = await EtaSubmissionModel.create([{
      tenantId, deviceId, environment: this.api.environment, receiptIds: ids, receiptUuids: batch.map((b) => b.uuid),
      status: 'SENDING', requestHash: sha256Hex(body), requestBytes: Buffer.byteLength(body), correlationId: randomUUID(), sentAt: this.now(),
    }]);
    const sid = submission!._id;
    const claimed = await this.move(tenantId, ids, 'QUEUED', 'SUBMITTING', `submission ${sid}`, { 'eta.submissionId': sid });
    if (claimed !== ids.length) {
      // Someone changed these receipts concurrently; put back what we claimed and stop without sending.
      const mine = await ReceiptModel.find({ tenantId, _id: { $in: ids }, 'eta.status': 'SUBMITTING', 'eta.submissionId': sid }, { _id: 1 }).lean();
      await this.move(tenantId, mine.map((m) => m._id), 'SUBMITTING', 'QUEUED', 'claim conflict');
      await EtaSubmissionModel.updateOne({ _id: sid, tenantId }, { $set: { status: 'FAILED', errorCode: 'CLAIM_CONFLICT' } });
      return { outcome: 'SKIPPED', reason: 'CLAIM_CONFLICT' };
    }
    await ReceiptModel.updateMany({ tenantId, _id: { $in: ids } }, { $inc: { 'eta.attempts': 1 } });

    const res = await this.api.submitReceipts(token, body);
    return this.handleSubmitOutcome(tenantId, deviceId, sid, batch, res);
  }

  private async handleSubmitOutcome(
    tenantId: Types.ObjectId, deviceId: Types.ObjectId, sid: Types.ObjectId,
    batch: Array<{ _id: Types.ObjectId; uuid: string; receiptNumber: string }>,
    res: HttpOutcome<import('./eta-api.js').SubmitResponse>,
  ): Promise<SubmitResult> {
    const ids = batch.map((b) => b._id);
    const subUpdate = (set: Record<string, unknown>) =>
      EtaSubmissionModel.updateOne({ _id: sid, tenantId }, { $set: { respondedAt: this.now(), durationMs: res.durationMs, ...set } });

    if (res.kind === 'transport_error') {
      await subUpdate({ status: 'UNKNOWN', errorCode: res.timedOut ? 'TIMEOUT' : 'TRANSPORT', errorMessage: res.message });
      await this.move(tenantId, ids, 'SUBMITTING', 'UNKNOWN', res.timedOut ? 'request timed out' : 'network error', {
        'eta.lastError': { code: res.timedOut ? 'TIMEOUT' : 'TRANSPORT', message: res.message, details: null },
        'eta.nextAttemptAt': new Date(this.now().getTime() + 60_000),
      });
      return { outcome: 'UNKNOWN', reason: res.timedOut ? 'TIMEOUT' : 'TRANSPORT', submissionId: String(sid) };
    }

    if (res.kind === 'http_error') {
      const err = { code: res.errorCode ?? `HTTP_${res.status}`, message: res.message ?? `HTTP ${res.status}`, details: res.body ?? null };
      await subUpdate({ status: res.status === 429 ? 'RETRY_LATER' : res.status >= 500 || res.status === 422 ? 'UNKNOWN' : 'FAILED', httpStatus: res.status, errorCode: err.code, errorMessage: err.message, retryAfterSeconds: res.retryAfterSeconds });
      if (res.status === 401) {
        // Token rejected: the request was not processed.
        this.tokens.invalidate(`${tenantId}:${deviceId}`);
        await this.move(tenantId, ids, 'SUBMITTING', 'QUEUED', 'access token rejected', { 'eta.lastError': err, 'eta.nextAttemptAt': new Date(this.now().getTime() + 30_000) });
        return { outcome: 'RETRY_LATER', reason: 'UNAUTHORIZED', submissionId: String(sid) };
      }
      if (res.status === 429) {
        const wait = (res.retryAfterSeconds ?? 60) * 1000;
        await this.move(tenantId, ids, 'SUBMITTING', 'QUEUED', 'throttled by ETA', { 'eta.lastError': err, 'eta.nextAttemptAt': new Date(this.now().getTime() + wait) });
        return { outcome: 'RETRY_LATER', reason: 'THROTTLED', submissionId: String(sid) };
      }
      if (res.status === 422 || res.status >= 500) {
        // 422 DuplicateSubmission means ETA already received this exact payload; 5xx outcome is uncertain. Reconcile, never resend blindly.
        await this.move(tenantId, ids, 'SUBMITTING', 'UNKNOWN', res.status === 422 ? 'duplicate submission reported' : `ETA HTTP ${res.status}`, {
          'eta.lastError': err, 'eta.nextAttemptAt': new Date(this.now().getTime() + Math.max(60_000, (res.retryAfterSeconds ?? 0) * 1000)),
        });
        return { outcome: 'UNKNOWN', reason: res.status === 422 ? 'DUPLICATE_SUBMISSION' : 'SERVER_ERROR', submissionId: String(sid) };
      }
      // 400 BadStructure / MaximumSizeExceeded, 403 IncorrectSubmitter, other 4xx: requires intervention.
      await this.move(tenantId, ids, 'SUBMITTING', 'FAILED', `ETA HTTP ${res.status} ${err.code}`, { 'eta.lastError': err });
      return { outcome: 'FAILED', reason: err.code, submissionId: String(sid) };
    }

    const submissionUuid = res.body?.submissionUUID ?? res.body?.submissionUuid ?? null;
    const accepted = new Map((res.body?.acceptedDocuments ?? []).map((d) => [d.uuid, d]));
    const rejected = new Map((res.body?.rejectedDocuments ?? []).filter((d) => d.uuid).map((d) => [d.uuid!, d]));
    const unaccounted: Types.ObjectId[] = [];
    for (const b of batch) {
      const a = accepted.get(b.uuid);
      const r = rejected.get(b.uuid);
      if (a) {
        await this.move(tenantId, [b._id], 'SUBMITTING', 'SUBMITTED', `accepted for processing in ${submissionUuid}`, {
          'eta.submissionUuid': submissionUuid, 'eta.longId': a.longId ?? null, 'eta.lastError': { code: null, message: null, details: null }, 'eta.nextAttemptAt': null,
        });
      } else if (r) {
        await this.move(tenantId, [b._id], 'SUBMITTING', 'REJECTED', r.error?.message ?? 'rejected', {
          'eta.submissionUuid': submissionUuid, 'eta.lastError': { code: r.error?.code ?? 'REJECTED', message: r.error?.message ?? null, details: r.error ?? null },
        });
      } else {
        unaccounted.push(b._id);
      }
    }
    if (unaccounted.length) await this.move(tenantId, unaccounted, 'SUBMITTING', 'UNKNOWN', 'not listed in submission response', { 'eta.nextAttemptAt': this.now() });
    await subUpdate({ status: accepted.size === 0 && rejected.size > 0 ? 'REJECTED' : 'ACCEPTED', httpStatus: res.status, submissionUuid, acceptedCount: accepted.size, rejectedCount: rejected.size });
    if (submissionUuid && accepted.size) await enqueueSafely('eta.poll-submission', { tenantId: String(tenantId), submissionUuid }, { delayMs: 10_000, jobId: `poll:${submissionUuid}` });
    // More receipts may be waiting behind this batch.
    await enqueueSafely('eta.submit-device', { tenantId: String(tenantId), deviceId: String(deviceId) }, { jobId: `submit:${deviceId}` });
    return { outcome: 'SUBMITTED', submissionId: String(sid), accepted: accepted.size, rejected: rejected.size };
  }

  /** Polls a submission (06-get-receipt-submission) and records official validation results. */
  async pollSubmission(tenantId: Types.ObjectId, submissionUuid: string): Promise<{ updated: number; pending: number }> {
    const sample = await ReceiptModel.findOne({ tenantId, 'eta.submissionUuid': submissionUuid }, { deviceId: 1 }).lean();
    if (!sample) return { updated: 0, pending: 0 };
    const token = await this.token(tenantId, sample.deviceId);
    let updated = 0;
    let page = 1;
    let totalPages = 1;
    let overall: string | undefined;
    do {
      const res = await this.api.getSubmission(token, submissionUuid, page, 100);
      if (res.kind !== 'ok') {
        if (res.kind === 'http_error' && res.status === 401) this.tokens.invalidate(`${tenantId}:${sample.deviceId}`);
        logger.warn({ submissionUuid, kind: res.kind }, 'Submission poll failed');
        break;
      }
      overall = res.body.status;
      totalPages = res.body.metadata?.totalPages ?? 1;
      for (const doc of res.body.receipts ?? []) {
        const mapped = mapOfficialDocumentStatus(doc.status);
        if (!mapped || mapped === 'IN_PROGRESS') continue;
        const r = await ReceiptModel.findOne({ tenantId, uuid: doc.uuid }, { _id: 1, 'eta.status': 1 }).lean();
        if (!r || r.eta.status !== 'SUBMITTED') continue;
        updated += await this.move(tenantId, [r._id], 'SUBMITTED', mapped, `ETA status ${doc.status}`, {
          ...(doc.longId ? { 'eta.longId': doc.longId } : {}),
          'eta.lastError': mapped === 'INVALID' ? { code: 'ETA_INVALID', message: 'ETA validation failed', details: doc.errors ?? null } : { code: null, message: null, details: null },
        });
      }
      page++;
    } while (page <= totalPages && page <= 50);

    await EtaSubmissionModel.updateOne({ tenantId, submissionUuid }, { $set: { lastPolledAt: this.now(), overallStatus: overall ?? null } });
    const pending = await ReceiptModel.countDocuments({ tenantId, 'eta.submissionUuid': submissionUuid, 'eta.status': 'SUBMITTED' });
    return { updated, pending };
  }

  /**
   * Resolves a receipt whose submission outcome is unknown. The receipt UUID
   * is computed locally, so ETA can be asked directly whether it has it
   * (03-get-receipt-details). Only after it has been "not found" for longer
   * than the duplicate window is the receipt queued again.
   */
  async reconcileReceipt(tenantId: Types.ObjectId, receiptId: Types.ObjectId): Promise<EtaStatus> {
    const r = await ReceiptModel.findOne({ tenantId, _id: receiptId }).lean();
    if (!r) throw AppError.notFound('Receipt');
    if (r.eta.status !== 'UNKNOWN') return r.eta.status as EtaStatus;
    const token = await this.token(tenantId, r.deviceId);
    const res = await this.api.getReceiptDetails(token, r.uuid);
    const now = this.now();

    if (res.kind === 'ok') {
      const mapped = mapOfficialDocumentStatus(res.body.receipt?.status);
      const to: EtaStatus = mapped === 'VALID' || mapped === 'INVALID' || mapped === 'CANCELLED' ? mapped : 'SUBMITTED';
      await this.move(tenantId, [r._id], 'UNKNOWN', to, `reconciled: found at ETA (${res.body.receipt?.status ?? 'no status'})`, {
        'eta.submissionUuid': res.body.submissionUUID ?? r.eta.submissionUuid ?? null,
        ...(res.body.receipt?.longId ? { 'eta.longId': res.body.receipt.longId } : {}),
        'eta.nextAttemptAt': null,
      });
      if (to === 'SUBMITTED' && res.body.submissionUUID) {
        await enqueueSafely('eta.poll-submission', { tenantId: String(tenantId), submissionUuid: res.body.submissionUUID }, { delayMs: 10_000 });
      }
      return to;
    }
    if (res.kind === 'http_error' && res.status === 404) {
      if (now.getTime() - new Date(r.eta.statusChangedAt).getTime() >= RECONCILE_GRACE_MS) {
        await this.move(tenantId, [r._id], 'UNKNOWN', 'QUEUED', 'reconciled: not found at ETA after grace period; safe to resend', { 'eta.nextAttemptAt': null });
        await enqueueSafely('eta.submit-device', { tenantId: String(tenantId), deviceId: String(r.deviceId) }, { jobId: `submit:${r.deviceId}` });
        return 'QUEUED';
      }
      await this.noteError(tenantId, [r._id], 'NOT_FOUND_YET', 'Not found at ETA yet; waiting before resending', 2 * 60_000);
      return 'UNKNOWN';
    }
    if (res.kind === 'http_error' && res.status === 401) this.tokens.invalidate(`${tenantId}:${r.deviceId}`);
    await this.noteError(tenantId, [r._id], res.kind === 'http_error' ? `HTTP_${res.status}` : 'TRANSPORT', 'Reconciliation attempt failed', 2 * 60_000);
    return 'UNKNOWN';
  }

  /** Operator action: re-queue receipts that FAILED after the cause was fixed (e.g. configuration). */
  async requeueFailed(tenantId: Types.ObjectId, receiptIds: Types.ObjectId[], reason: string): Promise<number> {
    return this.move(tenantId, receiptIds, 'FAILED', 'QUEUED', `operator requeue: ${reason}`, { 'eta.nextAttemptAt': null });
  }

  /** Operator action: queue receipts issued before submission was enabled. */
  async queueNotSubmitted(tenantId: Types.ObjectId, receiptIds: Types.ObjectId[]): Promise<number> {
    return this.move(tenantId, receiptIds, 'NOT_SUBMITTED', 'QUEUED', 'queued for submission', { 'eta.nextAttemptAt': null });
  }
}

let service: EtaIntegrationService | undefined;
export function getEtaService(): EtaIntegrationService {
  if (!service) throw new Error('ETA integration service is not configured');
  return service;
}
export function setEtaService(s: EtaIntegrationService | undefined): void {
  service = s;
}
