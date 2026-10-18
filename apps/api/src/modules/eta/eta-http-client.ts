import { logger } from '../../common/logging/logger.js';
import type { EtaApi, HttpOutcome, PosCredentials, ReceiptDetails, SubmissionDetails, SubmitResponse } from './eta-api.js';

export interface EtaHttpConfig {
  environment: 'preprod' | 'production';
  identityBaseUrl: string;
  apiBaseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) : null;
}

function extractError(body: unknown): { code: string | null; message: string | null } {
  if (!body || typeof body !== 'object') return { code: null, message: null };
  const b = body as Record<string, unknown>;
  const err = (b.error && typeof b.error === 'object' ? b.error : b) as Record<string, unknown>;
  const code = typeof err.code === 'string' ? err.code : typeof b.error === 'string' ? (b.error as string) : null;
  const message = typeof err.message === 'string' ? err.message : typeof b.error_description === 'string' ? (b.error_description as string) : null;
  return { code, message };
}

/** Real HTTP implementation. Never logs request bodies, credentials or tokens. */
export class EtaHttpClient implements EtaApi {
  readonly environment: 'preprod' | 'production';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: EtaHttpConfig) {
    this.environment = cfg.environment;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async call<T>(url: string, init: RequestInit, op: string): Promise<HttpOutcome<T>> {
    const started = Date.now();
    try {
      const res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.cfg.timeoutMs) });
      const durationMs = Date.now() - started;
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text.slice(0, 2000) };
      }
      logger.info({ op, status: res.status, durationMs }, 'ETA call');
      if (res.ok) return { kind: 'ok', status: res.status, body: body as T, durationMs };
      const { code, message } = extractError(body);
      return { kind: 'http_error', status: res.status, errorCode: code, message, body, retryAfterSeconds: parseRetryAfter(res.headers.get('retry-after')), durationMs };
    } catch (err) {
      const durationMs = Date.now() - started;
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn({ op, durationMs, timedOut, error: err instanceof Error ? err.message : String(err) }, 'ETA transport error');
      return { kind: 'transport_error', message: err instanceof Error ? err.message : String(err), timedOut, durationMs };
    }
  }

  authenticate(c: PosCredentials) {
    // OAuth2 client_credentials; form encoding is the OAuth2 standard (body encoding is not stated on the ETA page).
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret });
    return this.call<{ access_token: string; expires_in: number; token_type?: string }>(
      `${this.cfg.identityBaseUrl}/connect/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          posserial: c.posSerial,
          pososversion: c.posOsVersion,
          posmodelframework: c.posModelFramework,
          presharedkey: c.presharedKey,
        },
        body,
      },
      'authenticate',
    );
  }

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Language': 'ar' };
  }

  submitReceipts(token: string, bodyJson: string) {
    return this.call<SubmitResponse>(
      `${this.cfg.apiBaseUrl}/api/v1/receiptsubmissions`,
      { method: 'POST', headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' }, body: bodyJson },
      'submitReceipts',
    );
  }

  getSubmission(token: string, submissionUuid: string, pageNo: number, pageSize: number) {
    const qs = new URLSearchParams({ PageNo: String(pageNo), PageSize: String(pageSize) });
    return this.call<SubmissionDetails>(
      `${this.cfg.apiBaseUrl}/api/v1/receiptsubmissions/${encodeURIComponent(submissionUuid)}/details?${qs}`,
      { method: 'GET', headers: this.authHeaders(token) },
      'getSubmission',
    );
  }

  getReceiptDetails(token: string, uuid: string) {
    return this.call<ReceiptDetails>(
      `${this.cfg.apiBaseUrl}/api/v1/receipts/${encodeURIComponent(uuid)}/details`,
      { method: 'GET', headers: this.authHeaders(token) },
      'getReceiptDetails',
    );
  }
}
