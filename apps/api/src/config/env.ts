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
  const parsed = EnvSchema.safeParse(source);
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
