/**
 * Contract of the ETA eReceipt API used by this platform
 * (sdk.invoicing.eta.gov.eg/ereceiptapi/, reviewed 2026-10-18):
 *   POST {identity}/connect/token                         01-authenticate-pos
 *   POST {api}/api/v1/receiptsubmissions                  02-submit-receipt
 *   GET  {api}/api/v1/receipts/{uuid}/details             03-get-receipt-details
 *   GET  {api}/api/v1/receiptsubmissions/{uuid}/details   06-get-receipt-submission
 * Every call returns a discriminated outcome instead of throwing, so the
 * caller must decide explicitly what each outcome means for the receipt.
 */
export interface PosCredentials {
  clientId: string;
  clientSecret: string;
  presharedKey: string;
  posSerial: string;
  posOsVersion: string;
  posModelFramework: string;
}

export interface AccessToken {
  accessToken: string;
  expiresAt: number;
}

export interface EtaErrorBody {
  code?: string;
  message?: string;
  target?: string;
  propertyPath?: string;
  details?: EtaErrorBody[];
}

export interface AcceptedDocument {
  uuid: string;
  longId?: string;
  receiptNumber?: string;
}

export interface RejectedDocument {
  uuid?: string;
  receiptNumber?: string;
  error?: EtaErrorBody;
}

export type HttpOutcome<T> =
  | { kind: 'ok'; status: number; body: T; durationMs: number }
  | { kind: 'http_error'; status: number; errorCode: string | null; message: string | null; body: unknown; retryAfterSeconds: number | null; durationMs: number }
  /** Network error or timeout: the request may or may not have been processed. */
  | { kind: 'transport_error'; message: string; timedOut: boolean; durationMs: number };

export interface SubmitResponse {
  submissionUUID?: string;
  submissionUuid?: string;
  acceptedDocuments?: AcceptedDocument[];
  rejectedDocuments?: RejectedDocument[];
}

export interface DocumentSummary {
  uuid: string;
  receiptNumber?: string;
  status?: string;
  longId?: string;
  errors?: unknown;
}

export interface SubmissionDetails {
  submissionuuid?: string;
  status?: string;
  receiptsCount?: number;
  invalidReceiptCount?: number;
  submissionErrors?: unknown[];
  receipts?: DocumentSummary[];
  metadata?: { totalPages?: number; totalCount?: number; currentPageNo?: number };
}

export interface ReceiptDetails {
  submissionUUID?: string;
  receipt?: DocumentSummary & { statusReason?: string };
}

export interface EtaApi {
  readonly environment: 'preprod' | 'production' | 'simulated';
  authenticate(creds: PosCredentials): Promise<HttpOutcome<{ access_token: string; expires_in: number; token_type?: string }>>;
  submitReceipts(token: string, bodyJson: string): Promise<HttpOutcome<SubmitResponse>>;
  getSubmission(token: string, submissionUuid: string, pageNo: number, pageSize: number): Promise<HttpOutcome<SubmissionDetails>>;
  getReceiptDetails(token: string, uuid: string): Promise<HttpOutcome<ReceiptDetails>>;
}
