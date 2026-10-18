import { z } from 'zod';

/**
 * Environment configuration. Parsed once at startup; the process refuses to
 * start with an invalid configuration instead of failing later at runtime.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:4200')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.string().optional().default(''),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded'),
    ETA_ENVIRONMENT: z.enum(['preprod', 'production']).default('preprod'),
    ETA_IDENTITY_BASE_URL: z.url().default('https://id.preprod.eta.gov.eg'),
    ETA_API_BASE_URL: z.url().default('https://api.preprod.invoicing.eta.gov.eg'),
    ETA_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    ETA_SIGNING_MODE: z.enum(['none', 'external']).default('none'),
    // "simulated" uses the in-process ETA test double. Forbidden when NODE_ENV=production.
    ETA_TRANSPORT: z.enum(['http', 'simulated']).default('http'),
    ETA_RECEIPT_QR_TEMPLATE: z.string().optional().default(''),
    STORAGE_DIR: z.string().default('./storage'),
    // local: files under STORAGE_DIR. gridfs: inside MongoDB (required on serverless hosts such as Vercel).
    STORAGE_DRIVER: z.enum(['local', 'gridfs']).default('local'),
    // Shared secret for the scheduled sweep endpoint (Vercel Cron sends it as a Bearer token).
    CRON_SECRET: z.string().optional().default(''),
    // smtp(s)://user:pass@host:port — required in production for password reset and alert emails.
    SMTP_URL: z.string().optional().default(''),
    MAIL_FROM: z.string().optional().default('E-Receipts <no-reply@localhost>'),
    // Optional ClamAV daemon for upload scanning, host:port (e.g. clamav:3310).
    CLAMAV_ADDRESS: z.string().optional().default(''),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),
  })
  .superRefine((env, ctx) => {
    if (env.ETA_ENVIRONMENT === 'production' && env.ETA_SIGNING_MODE === 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['ETA_SIGNING_MODE'],
        message: 'Unsigned submissions are not allowed against the ETA production environment',
      });
    }
    if (env.NODE_ENV === 'production' && env.ETA_TRANSPORT === 'simulated') {
      ctx.addIssue({ code: 'custom', path: ['ETA_TRANSPORT'], message: 'The simulated ETA cannot be used in production' });
    }
    if (process.env.VERCEL && env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'Local file storage is temporary on Vercel; use STORAGE_DRIVER=gridfs' });
    }
    if (env.NODE_ENV === 'production' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required in production (password reset and alerts)' });
    }
    if (env.ETA_ENVIRONMENT === 'production' && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['ETA_ENVIRONMENT'],
        message: 'The ETA production environment may only be used when NODE_ENV=production',
      });
    }
    if (env.NODE_ENV === 'production' && env.ETA_IDENTITY_BASE_URL.includes('preprod') !== (env.ETA_ENVIRONMENT === 'preprod')) {
      ctx.addIssue({
        code: 'custom',
        path: ['ETA_IDENTITY_BASE_URL'],
        message: 'ETA base URLs do not match ETA_ENVIRONMENT',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const input: NodeJS.ProcessEnv = { ...source };
  // On Vercel: default the allowed origin to the production URL and keep uploads in MongoDB.
  if (input.VERCEL) {
    if (!input.CORS_ORIGINS && input.VERCEL_PROJECT_PRODUCTION_URL) input.CORS_ORIGINS = `https://${input.VERCEL_PROJECT_PRODUCTION_URL}`;
    input.STORAGE_DRIVER ??= 'gridfs';
    // Vercel Functions accept request bodies up to 4.5 MB.
    input.MAX_UPLOAD_MB ??= '4';
  }
  const parsed = EnvSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test hook: forget the cached configuration. */
export function resetEnvCache(): void {
  cached = undefined;
}
