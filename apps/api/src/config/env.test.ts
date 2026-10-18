import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  MONGODB_URI: 'mongodb://x', JWT_ACCESS_SECRET: 'x'.repeat(40), DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

describe('environment validation', () => {
  it('accepts a valid development configuration', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'development' }).ETA_ENVIRONMENT).toBe('preprod');
  });
  it('refuses the simulated ETA and unsigned submissions in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', ETA_TRANSPORT: 'simulated', ETA_SIGNING_MODE: 'external' })).toThrow(/simulated/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', ETA_ENVIRONMENT: 'production', ETA_TRANSPORT: 'http', ETA_SIGNING_MODE: 'none', SMTP_URL: 'smtp://x', ETA_IDENTITY_BASE_URL: 'https://id.eta.gov.eg', ETA_API_BASE_URL: 'https://api.invoicing.eta.gov.eg' })).toThrow(/Unsigned/);
  });
  it('requires SMTP in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', ETA_TRANSPORT: 'http', ETA_SIGNING_MODE: 'external' })).toThrow(/SMTP_URL/);
  });
  it('refuses the ETA production environment outside production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', ETA_ENVIRONMENT: 'production' })).toThrow(/production environment/);
  });
  it('rejects short secrets and wrong key sizes', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow();
    expect(() => loadEnv({ ...base, DATA_ENCRYPTION_KEY: 'abc' })).toThrow();
  });
});
