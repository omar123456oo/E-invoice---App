import { AppError } from '../../common/errors/app-error.js';
import type { AccessToken, EtaApi, PosCredentials } from './eta-api.js';

/**
 * Caches one access token per POS device in memory and refreshes it before
 * expiry (ETA tokens are valid ~1 hour; 01-authenticate-pos). Tokens are never
 * persisted or logged.
 */
export class TokenManager {
  private readonly cache = new Map<string, AccessToken>();
  private readonly inflight = new Map<string, Promise<AccessToken>>();

  constructor(private readonly api: EtaApi, private readonly now: () => number = Date.now) {}

  invalidate(deviceKey: string): void {
    this.cache.delete(deviceKey);
  }

  async get(deviceKey: string, creds: () => Promise<PosCredentials>): Promise<string> {
    const cached = this.cache.get(deviceKey);
    if (cached && cached.expiresAt - 60_000 > this.now()) return cached.accessToken;
    let pending = this.inflight.get(deviceKey);
    if (!pending) {
      pending = this.fetchToken(creds).finally(() => this.inflight.delete(deviceKey));
      this.inflight.set(deviceKey, pending);
    }
    const token = await pending;
    this.cache.set(deviceKey, token);
    return token.accessToken;
  }

  private async fetchToken(creds: () => Promise<PosCredentials>): Promise<AccessToken> {
    const res = await this.api.authenticate(await creds());
    if (res.kind === 'ok' && res.body?.access_token) {
      const ttl = Number(res.body.expires_in) > 0 ? Number(res.body.expires_in) : 3600;
      return { accessToken: res.body.access_token, expiresAt: this.now() + ttl * 1000 };
    }
    if (res.kind === 'http_error') {
      throw new AppError(502, 'ETA_AUTH_FAILED', `ETA authentication failed (${res.status}${res.errorCode ? ` ${res.errorCode}` : ''})`);
    }
    throw new AppError(503, 'ETA_UNREACHABLE', 'ETA identity service is unreachable');
  }
}
