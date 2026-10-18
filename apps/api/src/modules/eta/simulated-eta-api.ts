import { randomUUID } from 'node:crypto';
import type { EtaApi, HttpOutcome, ReceiptDetails, SubmissionDetails, SubmitResponse } from './eta-api.js';
import { parseEtaJson } from './serializer.js';

type Behaviour = 'accept' | 'reject-all' | 'timeout' | 'server-error' | 'unauthorized' | 'throttle' | 'duplicate' | 'bad-structure';

/**
 * SIMULATED ETA. A test double for automated tests and local demos only.
 * Its responses are modelled on the documented response shapes, but nothing
 * it returns has been produced by ETA, and it must never be wired up in
 * production (the composition root refuses to do so).
 */
export class SimulatedEtaApi implements EtaApi {
  readonly environment = 'simulated' as const;
  behaviour: Behaviour = 'accept';
  /** Final document status the simulator reports when polled. */
  validationOutcome: (uuid: string) => 'Valid' | 'Invalid' = () => 'Valid';
  /** When set, a timed-out submission is recorded as received (models "processed but response lost"). */
  timeoutButProcessed = false;
  readonly received = new Map<string, { submissionUuid: string; receiptNumber: string; status: 'Valid' | 'Invalid' | 'InProgress' }>();
  readonly calls: Array<{ op: string; body?: string }> = [];
  pollsUntilValidated = 0;
  private polls = 0;

  private ok<T>(body: T, status = 200): HttpOutcome<T> {
    return { kind: 'ok', status, body, durationMs: 1 };
  }

  async authenticate() {
    this.calls.push({ op: 'authenticate' });
    if (this.behaviour === 'unauthorized') return { kind: 'http_error' as const, status: 400, errorCode: 'invalid_client', message: 'invalid client', body: {}, retryAfterSeconds: null, durationMs: 1 };
    return this.ok({ access_token: `sim-${randomUUID()}`, expires_in: 3600, token_type: 'Bearer' });
  }

  private record(body: string): { uuid: string; receiptNumber: string }[] {
    const parsed = parseEtaJson(body) as { receipts: Array<{ header: { uuid: string; receiptNumber: string } }> };
    return parsed.receipts.map((r) => ({ uuid: r.header.uuid, receiptNumber: r.header.receiptNumber }));
  }

  async submitReceipts(_token: string, body: string): Promise<HttpOutcome<SubmitResponse>> {
    this.calls.push({ op: 'submit', body });
    const docs = this.record(body);
    const submissionUuid = randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 26);
    switch (this.behaviour) {
      case 'timeout':
        if (this.timeoutButProcessed) for (const d of docs) this.received.set(d.uuid, { submissionUuid, receiptNumber: d.receiptNumber, status: this.validationOutcome(d.uuid) });
        return { kind: 'transport_error', message: 'The operation was aborted due to timeout', timedOut: true, durationMs: 30000 };
      case 'server-error':
        return { kind: 'http_error', status: 503, errorCode: null, message: 'Service Unavailable', body: null, retryAfterSeconds: null, durationMs: 1 };
      case 'unauthorized':
        return { kind: 'http_error', status: 401, errorCode: null, message: 'Unauthorized', body: null, retryAfterSeconds: null, durationMs: 1 };
      case 'throttle':
        return { kind: 'http_error', status: 429, errorCode: null, message: 'Too many requests', body: null, retryAfterSeconds: 30, durationMs: 1 };
      case 'duplicate':
        return { kind: 'http_error', status: 422, errorCode: 'DuplicateSubmission', message: 'Duplicate submission', body: null, retryAfterSeconds: 600, durationMs: 1 };
      case 'bad-structure':
        return { kind: 'http_error', status: 400, errorCode: 'BadStructure', message: 'Bad structure', body: { error: { code: 'BadStructure', message: 'Bad structure' } }, retryAfterSeconds: null, durationMs: 1 };
      case 'reject-all':
        return this.ok({ submissionUUID: submissionUuid, acceptedDocuments: [], rejectedDocuments: docs.map((d) => ({ uuid: d.uuid, receiptNumber: d.receiptNumber, error: { code: 'CV001', message: 'SIMULATED rejection', target: d.uuid, details: [] } })) }, 202);
      case 'accept':
      default:
        for (const d of docs) {
          if (this.received.has(d.uuid)) continue;
          this.received.set(d.uuid, { submissionUuid, receiptNumber: d.receiptNumber, status: 'InProgress' });
        }
        return this.ok({ submissionUUID: submissionUuid, acceptedDocuments: docs.map((d, i) => ({ uuid: d.uuid, longId: `SIMLONG${i}${d.uuid.slice(0, 10)}`, receiptNumber: d.receiptNumber })), rejectedDocuments: [] }, 202);
    }
  }

  private settle(uuid: string): void {
    const r = this.received.get(uuid);
    if (r && r.status === 'InProgress' && this.polls > this.pollsUntilValidated) r.status = this.validationOutcome(uuid);
  }

  async getSubmission(_token: string, submissionUuid: string): Promise<HttpOutcome<SubmissionDetails>> {
    this.calls.push({ op: 'getSubmission' });
    this.polls++;
    const receipts = [...this.received.entries()].filter(([, v]) => v.submissionUuid === submissionUuid);
    if (receipts.length === 0) return { kind: 'http_error', status: 404, errorCode: 'NotFound', message: 'Not found', body: null, retryAfterSeconds: null, durationMs: 1 };
    receipts.forEach(([uuid]) => this.settle(uuid));
    const statuses = receipts.map(([, v]) => v.status);
    const overall = statuses.includes('InProgress') ? 'InProgress' : statuses.includes('Invalid') ? 'Invalid' : 'Valid';
    return this.ok({
      submissionuuid: submissionUuid,
      status: overall,
      receiptsCount: receipts.length,
      receipts: receipts.map(([uuid, v]) => ({
        uuid, receiptNumber: v.receiptNumber, status: v.status === 'InProgress' ? 'Submitted' : v.status,
        errors: v.status === 'Invalid' ? [{ stepName: 'SIMULATED validation', error: { errorCode: 'CV307', error: 'SIMULATED item code error' } }] : undefined,
      })),
      metadata: { totalPages: 1, totalCount: receipts.length, currentPageNo: 1 },
    });
  }

  async getReceiptDetails(_token: string, uuid: string): Promise<HttpOutcome<ReceiptDetails>> {
    this.calls.push({ op: 'getReceiptDetails' });
    const r = this.received.get(uuid);
    // Documented: issuers can retrieve receipts in valid and cancelled status.
    if (!r) return { kind: 'http_error', status: 404, errorCode: 'NotFound', message: 'Not found', body: null, retryAfterSeconds: null, durationMs: 1 };
    this.settle(uuid);
    return this.ok({ submissionUUID: r.submissionUuid, receipt: { uuid, receiptNumber: r.receiptNumber, status: r.status === 'InProgress' ? 'Submitted' : r.status } });
  }
}
