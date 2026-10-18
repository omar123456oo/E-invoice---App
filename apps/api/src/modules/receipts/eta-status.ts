/**
 * ETA processing state machine for a receipt. This is deliberately separate
 * from the internal transaction status. Official ETA statuses (Valid,
 * Invalid, Cancelled; submission InProgress/Valid/Invalid — see
 * ereceiptapi/06-get-receipt-submission) are mapped onto these states; the
 * other states describe our side of the integration.
 *
 *  NOT_SUBMITTED  issued internally, ETA submission not enabled/requested
 *  QUEUED         waiting to be sent
 *  SUBMITTING     request in flight (claimed by a worker)
 *  UNKNOWN        request outcome unknown (timeout, 5xx, network, duplicate) — must be reconciled, never blindly resent
 *  SUBMITTED      ETA returned it in acceptedDocuments (HTTP 202); validation pending
 *  REJECTED       ETA returned it in rejectedDocuments at submission time
 *  FAILED         submission refused for a reason requiring intervention (bad structure, wrong submitter, config)
 *  VALID          ETA status Valid — the only state that means officially registered
 *  INVALID        ETA status Invalid after validation
 *  CANCELLED      ETA status Cancelled
 *  SUPERSEDED     replaced by a corrected receipt that references it (referenceOldUUID)
 */
export const ETA_STATUSES = [
  'NOT_SUBMITTED', 'QUEUED', 'SUBMITTING', 'UNKNOWN', 'SUBMITTED', 'REJECTED', 'FAILED', 'VALID', 'INVALID', 'CANCELLED', 'SUPERSEDED',
] as const;
export type EtaStatus = (typeof ETA_STATUSES)[number];

export const TRANSITIONS: Record<EtaStatus, readonly EtaStatus[]> = {
  NOT_SUBMITTED: ['QUEUED'],
  QUEUED: ['SUBMITTING'],
  SUBMITTING: ['SUBMITTED', 'REJECTED', 'FAILED', 'UNKNOWN', 'QUEUED'],
  UNKNOWN: ['SUBMITTED', 'VALID', 'INVALID', 'CANCELLED', 'REJECTED', 'QUEUED'],
  SUBMITTED: ['VALID', 'INVALID', 'CANCELLED'],
  REJECTED: ['SUPERSEDED'],
  FAILED: ['QUEUED', 'SUPERSEDED'],
  VALID: ['CANCELLED'],
  INVALID: ['SUPERSEDED'],
  CANCELLED: [],
  SUPERSEDED: [],
};

export function canTransition(from: EtaStatus, to: EtaStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(public readonly from: EtaStatus, public readonly to: EtaStatus) {
    super(`Invalid ETA status transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: EtaStatus, to: EtaStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Maps an official ETA document status string. Unknown values return null and must not change state. */
export function mapOfficialDocumentStatus(status: string | null | undefined): Extract<EtaStatus, 'VALID' | 'INVALID' | 'CANCELLED'> | 'IN_PROGRESS' | null {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'valid':
      return 'VALID';
    case 'invalid':
      return 'INVALID';
    case 'cancelled':
    case 'canceled':
      return 'CANCELLED';
    case 'submitted':
    case 'inprogress':
      return 'IN_PROGRESS';
    default:
      return null;
  }
}

/** Only these states represent a receipt registered with ETA. */
export const OFFICIALLY_REGISTERED: ReadonlySet<EtaStatus> = new Set(['VALID']);
