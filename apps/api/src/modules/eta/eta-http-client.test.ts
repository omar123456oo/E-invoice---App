import { describe, expect, it } from 'vitest';
import { EtaHttpClient } from './eta-http-client.js';

function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no response configured');
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), { status: next.status, headers: next.headers });
  }) as typeof fetch;
  return { impl, calls };
}

const cfg = { environment: 'preprod' as const, identityBaseUrl: 'https://id.example', apiBaseUrl: 'https://api.example', timeoutMs: 1000 };
const creds = { clientId: 'cid', clientSecret: 'secret', presharedKey: 'psk', posSerial: 'SN1', posOsVersion: 'os', posModelFramework: '1' };

describe('EtaHttpClient', () => {
  it('authenticates with client credentials and the documented POS headers', async () => {
    const f = fakeFetch([{ status: 200, body: { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' } }]);
    const c = new EtaHttpClient({ ...cfg, fetchImpl: f.impl });
    const res = await c.authenticate(creds);
    expect(res.kind).toBe('ok');
    expect(f.calls[0]!.url).toBe('https://id.example/connect/token');
    const h = f.calls[0]!.init.headers as Record<string, string>;
    expect(h).toMatchObject({ posserial: 'SN1', pososversion: 'os', posmodelframework: '1', presharedkey: 'psk' });
    expect(String(f.calls[0]!.init.body)).toBe('grant_type=client_credentials&client_id=cid&client_secret=secret');
  });

  it('submits to /api/v1/receiptsubmissions with a bearer token and passes the body through unchanged', async () => {
    const f = fakeFetch([{ status: 202, body: { submissionUUID: 'S1', acceptedDocuments: [], rejectedDocuments: [] } }]);
    const c = new EtaHttpClient({ ...cfg, fetchImpl: f.impl });
    const body = '{"receipts":[{"a":10.50}]}';
    const res = await c.submitReceipts('tok', body);
    expect(res).toMatchObject({ kind: 'ok', status: 202 });
    expect(f.calls[0]!.url).toBe('https://api.example/api/v1/receiptsubmissions');
    expect(f.calls[0]!.init.body).toBe(body);
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('classifies HTTP errors with Retry-After and transport failures', async () => {
    const f = fakeFetch([{ status: 422, body: { error: { code: 'DuplicateSubmission', message: 'dup' } }, headers: { 'Retry-After': '600' } }, Object.assign(new Error('timeout'), { name: 'TimeoutError' })]);
    const c = new EtaHttpClient({ ...cfg, fetchImpl: f.impl });
    const a = await c.submitReceipts('tok', '{}');
    expect(a).toMatchObject({ kind: 'http_error', status: 422, errorCode: 'DuplicateSubmission', retryAfterSeconds: 600 });
    const b = await c.getReceiptDetails('tok', 'u'.repeat(64));
    expect(b).toMatchObject({ kind: 'transport_error', timedOut: true });
  });

  it('uses the documented status endpoints', async () => {
    const f = fakeFetch([{ status: 200, body: {} }, { status: 200, body: {} }]);
    const c = new EtaHttpClient({ ...cfg, fetchImpl: f.impl });
    await c.getSubmission('tok', 'SUB', 2, 50);
    await c.getReceiptDetails('tok', 'abc');
    expect(f.calls[0]!.url).toBe('https://api.example/api/v1/receiptsubmissions/SUB/details?PageNo=2&PageSize=50');
    expect(f.calls[1]!.url).toBe('https://api.example/api/v1/receipts/abc/details');
  });
});
